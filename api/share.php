<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

// ─── DB connection ────────────────────────────────────────────────────────────

// config.php lives one level above the web root so it is never publicly
// accessible. Adjust the path if your host's directory layout differs.
require_once __DIR__ . '/../../config.php';

try {
    $pdo = new PDO(
        'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4',
        DB_USER,
        DB_PASS,
        [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ],
    );
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Database unavailable']);
    exit;
}

// Create table on first run — cheap no-op on subsequent requests.
$pdo->exec("
    CREATE TABLE IF NOT EXISTS comparebuilds_shares (
        id         CHAR(6)    NOT NULL PRIMARY KEY,
        data       MEDIUMTEXT NOT NULL,
        created_at TIMESTAMP  NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
");

// ─── Route ────────────────────────────────────────────────────────────────────

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// ── GET ?id=xxxxxx ────────────────────────────────────────────────────────────
if ($method === 'GET') {
    $id = $_GET['id'] ?? '';

    if (!preg_match('/^[A-Za-z0-9]{6}$/', $id)) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid ID format']);
        exit;
    }

    $stmt = $pdo->prepare('SELECT data FROM comparebuilds_shares WHERE id = ?');
    $stmt->execute([$id]);
    $row = $stmt->fetch();

    if (!$row) {
        http_response_code(404);
        echo json_encode(['error' => 'Share not found or has expired']);
        exit;
    }

    // Return the stored JSON blob directly — already validated on write
    echo $row['data'];
    exit;
}

// ── POST ──────────────────────────────────────────────────────────────────────
if ($method === 'POST') {
    $raw  = file_get_contents('php://input');
    $body = json_decode($raw, true);

    if (!is_array($body)) {
        http_response_code(400);
        echo json_encode(['error' => 'Expected JSON body']);
        exit;
    }

    // Structural validation
    $classId = $body['classId'] ?? null;
    $specId  = $body['specId']  ?? null;
    $builds  = $body['builds']  ?? null;

    if (!is_int($classId) || !is_int($specId) || !is_array($builds)) {
        http_response_code(400);
        echo json_encode(['error' => 'Missing or invalid fields: classId, specId, builds']);
        exit;
    }

    if (count($builds) < 2 || count($builds) > 5) {
        http_response_code(400);
        echo json_encode(['error' => 'builds must contain 2–5 entries']);
        exit;
    }

    foreach ($builds as $b) {
        if (!is_string($b) || $b === '' || strlen($b) > 2000) {
            http_response_code(400);
            echo json_encode(['error' => 'Each build must be a non-empty string ≤ 2000 chars']);
            exit;
        }
    }

    // Cleanup rows older than 90 days (fire-and-forget per-request strategy)
    try {
        $pdo->exec("DELETE FROM comparebuilds_shares WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY)");
    } catch (Exception) {
        // Non-fatal — proceed even if cleanup fails
    }

    // Generate a unique 6-char alphanumeric ID
    $chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    $id    = null;

    for ($attempt = 0; $attempt < 10; $attempt++) {
        $candidate = '';
        for ($j = 0; $j < 6; $j++) {
            $candidate .= $chars[random_int(0, 61)];
        }
        $check = $pdo->prepare('SELECT 1 FROM comparebuilds_shares WHERE id = ?');
        $check->execute([$candidate]);
        if (!$check->fetch()) {
            $id = $candidate;
            break;
        }
    }

    if ($id === null) {
        http_response_code(500);
        echo json_encode(['error' => 'Could not generate a unique share ID — please retry']);
        exit;
    }

    // Store only the validated fields, not the raw body
    $stored = json_encode(
        ['classId' => $classId, 'specId' => $specId, 'builds' => $builds],
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES,
    );

    $stmt = $pdo->prepare('INSERT INTO comparebuilds_shares (id, data) VALUES (?, ?)');
    $stmt->execute([$id, $stored]);

    echo json_encode(['id' => $id]);
    exit;
}

// ── Method not allowed ────────────────────────────────────────────────────────
http_response_code(405);
echo json_encode(['error' => 'Method not allowed']);
