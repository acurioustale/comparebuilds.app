<?php

declare(strict_types=1);

// Ensure this script can only be run via command line (cron), not over the web
if (php_sapi_name() !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}

require_once __DIR__ . '/../../../config.php';

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

    // Prune shares older than 180 days (~6 months) in batches to prevent lock contention
    $stmt = $pdo->prepare('DELETE FROM comparebuilds_shares WHERE created_at < NOW() - INTERVAL 180 DAY LIMIT 1000');
    try {
        $totalPruned = 0;
        do {
            $stmt->execute();
            $count = $stmt->rowCount();
            $totalPruned += $count;
            if ($count > 0) {
                usleep(50000); // 50ms pause to allow concurrent queries and replication to breathe
            }
        } while ($count === 1000);
        echo 'Pruned ' . $totalPruned . " expired shares successfully.\n";
    } catch (PDOException $e) {
        if (($e->errorInfo[0] ?? '') === '42S02' || ($e->errorInfo[1] ?? 0) === 1146) {
            echo "Table comparebuilds_shares does not exist yet (no shares created). Exiting cleanly.\n";
        } else {
            throw $e;
        }
    }

    // Prune cache_og image files older than 180 days
    $cacheDir = __DIR__ . '/../../../cache_og';
    if (is_dir($cacheDir)) {
        $expireTime = time() - (180 * 86400);
        $iterator = new DirectoryIterator($cacheDir);
        $imgCount = 0;
        foreach ($iterator as $fileinfo) {
            if ($fileinfo->isFile() && $fileinfo->getMTime() < $expireTime) {
                @unlink($fileinfo->getPathname());
                $imgCount++;
            }
        }
        echo 'Pruned ' . $imgCount . " expired OG cached images successfully.\n";
    }
} catch (Throwable $e) {
    error_log('Share pruning cron failed: ' . $e->getMessage());
    exit(1);
}
