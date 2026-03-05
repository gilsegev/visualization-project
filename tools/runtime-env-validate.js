function toBool(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function toInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
}

function isStrictRuntime(env) {
  if (toBool(env.RUNTIME_ENV_STRICT, false)) return true;
  if (String(env.NODE_ENV || '').toLowerCase() === 'production') return true;
  return Boolean(env.RAILWAY_PROJECT_ID || env.RAILWAY_ENVIRONMENT_ID || env.RAILWAY_SERVICE_ID);
}

function requireNonEmpty(env, key, errors) {
  if (String(env[key] || '').trim()) return;
  errors.push(`Missing required env var: ${key}`);
}

function requireBoolTrue(env, key, errors) {
  if (toBool(env[key], false)) return;
  errors.push(`Expected ${key}=true for this runtime profile`);
}

function requireBoolSet(env, key, errors) {
  const raw = String(env[key] ?? '').trim().toLowerCase();
  if (raw === 'true' || raw === 'false') return;
  errors.push(`Expected ${key} to be explicitly set to true or false`);
}

function requireIntRange(env, key, min, max, errors) {
  const parsed = toInt(env[key], NaN);
  if (Number.isFinite(parsed) && parsed >= min && parsed <= max) return;
  errors.push(`Expected ${key} to be an integer in [${min}, ${max}]`);
}

function validateObjectStorage(env, errors) {
  const provider = String(env.OBJECT_STORE_PROVIDER || '').trim().toLowerCase();
  if (provider !== 'r2' && provider !== 's3') {
    errors.push('Expected OBJECT_STORE_PROVIDER to be set to r2 or s3 when DOC_PIPELINE_ENABLED=true');
    return;
  }
  requireNonEmpty(env, 'S3_ENDPOINT', errors);
  requireNonEmpty(env, 'S3_REGION', errors);
  requireNonEmpty(env, 'S3_BUCKET', errors);
  requireNonEmpty(env, 'S3_ACCESS_KEY_ID', errors);
  requireNonEmpty(env, 'S3_SECRET_ACCESS_KEY', errors);
}

function validateApp(env, errors, warnings) {
  requireNonEmpty(env, 'DATABASE_URL', errors);
  requireNonEmpty(env, 'INITIAL_ADMIN_KEY', errors);
  requireNonEmpty(env, 'ALLOWED_ORIGINS', errors);
  requireNonEmpty(env, 'IQC_URL', errors);
  requireNonEmpty(env, 'OPENROUTER_API_KEY', errors);
  requireNonEmpty(env, 'SILICONFLOW_API_KEY', errors);
  requireBoolTrue(env, 'POSTGRES_ENABLED', errors);
  requireBoolSet(env, 'DURABLE_QUEUE_ENABLED', errors);
  requireIntRange(env, 'WORKER_COUNT', 0, 64, errors);

  if (!toBool(env.DURABLE_QUEUE_ENABLED, true)) {
    warnings.push('DURABLE_QUEUE_ENABLED=false on app service; queue orchestration mode is disabled.');
  }

  const hasSourceProvider = String(env.UNSPLASH_ACCESS_KEY || '').trim() || String(env.PIXABAY_API_KEY || '').trim();
  if (!hasSourceProvider) {
    warnings.push('No sourced-image provider key set (UNSPLASH_ACCESS_KEY or PIXABAY_API_KEY).');
  }

  if (toBool(env.DOC_PIPELINE_ENABLED, false)) {
    validateObjectStorage(env, errors);
  }
}

function validateWorker(env, errors, warnings) {
  requireNonEmpty(env, 'DATABASE_URL', errors);
  requireNonEmpty(env, 'INITIAL_ADMIN_KEY', errors);
  requireNonEmpty(env, 'IQC_URL', errors);
  requireNonEmpty(env, 'OPENROUTER_API_KEY', errors);
  requireNonEmpty(env, 'SILICONFLOW_API_KEY', errors);
  requireBoolTrue(env, 'POSTGRES_ENABLED', errors);
  requireBoolTrue(env, 'DURABLE_QUEUE_ENABLED', errors);
  requireIntRange(env, 'WORKER_COUNT', 1, 64, errors);
  requireNonEmpty(env, 'PROCESS_ROLE', errors);
  if (String(env.PROCESS_ROLE || '').trim() !== 'worker') {
    errors.push('Expected PROCESS_ROLE=worker for worker runtime profile');
  }

  const hasSourceProvider = String(env.UNSPLASH_ACCESS_KEY || '').trim() || String(env.PIXABAY_API_KEY || '').trim();
  if (!hasSourceProvider) {
    warnings.push('No sourced-image provider key set (UNSPLASH_ACCESS_KEY or PIXABAY_API_KEY).');
  }

  if (toBool(env.DOC_PIPELINE_ENABLED, false)) {
    validateObjectStorage(env, errors);
  }
}

function validateIqc(env, errors) {
  requireNonEmpty(env, 'OPENROUTER_API_KEY', errors);
  requireNonEmpty(env, 'OPENROUTER_MODEL', errors);
  requireNonEmpty(env, 'OPENROUTER_VISION_MODEL', errors);
  requireIntRange(env, 'IQC_PORT', 1, 65535, errors);
}

function assertRuntimeEnv(profile, env = process.env) {
  const strict = isStrictRuntime(env);
  if (!strict) return;

  const errors = [];
  const warnings = [];

  if (profile === 'app') validateApp(env, errors, warnings);
  if (profile === 'worker') validateWorker(env, errors, warnings);
  if (profile === 'iqc') validateIqc(env, errors, warnings);

  for (const warning of warnings) {
    console.warn(`[env-validate:${profile}] WARN ${warning}`);
  }

  if (errors.length > 0) {
    console.error(`[env-validate:${profile}] FAIL ${errors.length} error(s):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log(`[env-validate:${profile}] OK`);
}

module.exports = {
  assertRuntimeEnv,
};
