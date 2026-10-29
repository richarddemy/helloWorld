<?php
/*
 * Copy OUTSIDE public_html as bw-push-secrets.php.
 * Never commit or publish your real values.
 * Set BW_PUSH_CONFIG to the absolute path if needed.
 */
return [
    // Random server-to-server bearer secret, at least 32 characters.
    'shared_secret' => 'REPLACE_WITH_RANDOM_64_CHARACTER_SECRET',
    'vapid_subject' => 'mailto:admin@example.com',
    'vapid_public_key' => 'REPLACE_WITH_GENERATED_PUBLIC_VAPID_KEY',
    'vapid_private_key' => 'REPLACE_WITH_GENERATED_PRIVATE_VAPID_KEY',
];
