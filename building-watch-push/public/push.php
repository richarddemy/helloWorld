<?php
declare(strict_types=1);

/*
 * HTTPS-only Web Push gateway, called from private Google Apps Script.
 * Never deploy VAPID private keys or the shared secret in this directory.
 * Requires composer install in the gateway directory.
 */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    header('Allow: POST');
    echo json_encode(['error' => 'POST required']);
    exit;
}
if (empty($_SERVER['HTTPS']) || $_SERVER['HTTPS'] === 'off') {
    // Configure HTTPS termination correctly behind a trusted reverse proxy.
    http_response_code(403);
    echo json_encode(['error' => 'HTTPS required']);
    exit;
}
$configPath = getenv('BW_PUSH_CONFIG') ?: dirname(__DIR__, 3) . '/bw-push-secrets.php';
if (!is_file($configPath)) {
    http_response_code(503);
    echo json_encode(['error' => 'Push gateway not configured']);
    exit;
}
$config = require $configPath;
$authorization = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
$secret = (string)($config['shared_secret'] ?? '');
if (strlen($secret) < 32 || !hash_equals('Bearer ' . $secret, $authorization)) {
    http_response_code(401);
    echo json_encode(['error' => 'Unauthorized']);
    exit;
}
$raw = file_get_contents('php://input');
if ($raw === false || strlen($raw) > 150000) {
    http_response_code(413);
    echo json_encode(['error' => 'Request too large']);
    exit;
}
try {
    $data = json_decode($raw, true, 20, JSON_THROW_ON_ERROR);
} catch (Throwable $e) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid JSON']);
    exit;
}
$subs = $data['subscriptions'] ?? null;
$notification = $data['notification'] ?? null;
if (!is_array($subs) || count($subs) < 1 || count($subs) > 50 || !is_array($notification)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid notification payload']);
    exit;
}
$allowedBase = 'https://richarddemy.github.io/helloWorld/building-watch-trek/';
$url = (string)($notification['url'] ?? $allowedBase);
if (!str_starts_with($url, $allowedBase)) $url = $allowedBase;
$payload = json_encode([
    // No person's location, identity or message is transmitted to lock screens.
    'title' => 'Building Watch — Assistance requested',
    'body' => 'Someone is trying to reach you. Open Building Watch to respond.',
    'url' => $url,
    'tag' => substr((string)($notification['tag'] ?? 'building-watch-assistance'), 0, 120),
], JSON_UNESCAPED_SLASHES);
require dirname(__DIR__) . '/vendor/autoload.php';
try {
    $webPush = new Minishlink\WebPush\WebPush([
        'VAPID' => [
            'subject' => (string)$config['vapid_subject'],
            'publicKey' => (string)$config['vapid_public_key'],
            'privateKey' => (string)$config['vapid_private_key']
        ],
    ], ['TTL' => 3600, 'urgency' => 'high']);
    $queued = 0;
    foreach ($subs as $sub) {
        if (!is_array($sub)) continue;
        $endpoint = (string)($sub['endpoint'] ?? '');
        $host = parse_url($endpoint, PHP_URL_HOST);
        if (!is_string($host) || !preg_match(
            '/(^|\.)fcm\.googleapis\.com$|(^|\.)push\.services\.mozilla\.com$|(^|\.)web\.push\.apple\.com$|(^|\.)notify\.windows\.com$/i',
            $host
        )) continue;
        if (parse_url($endpoint, PHP_URL_SCHEME) !== 'https') continue;
        $keys = $sub['keys'] ?? [];
        if (!is_array($keys)) continue;
        if (!preg_match('/^[A-Za-z0-9_-]{60,160}$/', (string)($keys['p256dh'] ?? '')) ||
            !preg_match('/^[A-Za-z0-9_-]{16,60}$/', (string)($keys['auth'] ?? ''))) continue;
        $subscription = Minishlink\WebPush\Subscription::create([
            'endpoint' => $endpoint,
            'keys' => [
                'p256dh' => $keys['p256dh'],
                'auth' => $keys['auth']
            ],
        ]);
        $webPush->queueNotification($subscription, $payload);
        $queued++;
    }
    $accepted = 0;
    foreach ($webPush->flush() as $report) {
        if ($report->isSuccess()) $accepted++;
        // Do not log tokens, endpoints, recipient addresses or message data.
    }
    echo json_encode(['accepted' => $accepted, 'queued' => $queued]);
} catch (Throwable $e) {
    error_log('Building Watch push dispatcher error: ' . get_class($e));
    http_response_code(503);
    echo json_encode(['error' => 'Push delivery unavailable']);
}
