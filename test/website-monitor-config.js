'use strict';

/**
 * Configuration for the website monitoring system.
 * All values can be overridden via environment variables.
 */
const config = {
    // Request settings
    requestTimeout: parseInt(process.env.MONITOR_TIMEOUT_MS, 10) || 10000,
    maxRetries: parseInt(process.env.MONITOR_MAX_RETRIES, 10) || 3,
    retryDelay: parseInt(process.env.MONITOR_RETRY_DELAY_MS, 10) || 1000,

    // Concurrency settings
    concurrency: parseInt(process.env.MONITOR_CONCURRENCY, 10) || 5,
    rateLimitDelay: parseInt(process.env.MONITOR_RATE_LIMIT_MS, 10) || 200,

    // Performance thresholds
    slowLinkThresholdMs: parseInt(process.env.MONITOR_SLOW_THRESHOLD_MS, 10) || 2000,

    // Caching
    cacheEnabled: process.env.MONITOR_CACHE_ENABLED !== 'false',
    cacheTtlMs: parseInt(process.env.MONITOR_CACHE_TTL_MS, 10) || 60000,

    // Modes
    debugMode: process.env.MONITOR_DEBUG === 'true',
    dryRun: process.env.MONITOR_DRY_RUN === 'true',

    // URL filtering
    ignorePatterns: process.env.MONITOR_IGNORE_PATTERNS
        ? process.env.MONITOR_IGNORE_PATTERNS.split(',').map(p => p.trim())
        : [],

    // Email
    websiteUrl: process.env.WEBSITE_URL || 'https://pggllc.github.io/Housing-Analytics/',
    recipientEmail: process.env.RECIPIENT_EMAIL || 'communityplanner@gmail.com',
    emailUser: process.env.EMAIL_USER,
    emailPassword: process.env.EMAIL_PASSWORD,
};

module.exports = config;
