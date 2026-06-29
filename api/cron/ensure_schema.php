<?php

declare(strict_types=1);

// Ensure this script can only be run via command line (cron/migration), not over the web
if (php_sapi_name() !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}

require_once __DIR__ . '/../../../config.php';
define('SHARE_API_NO_MAIN', true);
require_once __DIR__ . '/../share.php';

try {
    $pdo = get_db_connection();
    ensure_share_schema($pdo);
    echo "Schema ensured successfully.\n";
} catch (Throwable $e) {
    error_log('Schema migration failed: ' . $e->getMessage());
    exit(1);
}
