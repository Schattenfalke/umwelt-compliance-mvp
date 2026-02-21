type Bucket = {
  timestamps: number[];
};

const buckets = new Map<string, Bucket>();

export function checkSlidingWindowRateLimit(params: {
  key: string;
  nowMs?: number;
  windowSec: number;
  maxRequests: number;
}): { allowed: boolean; retryAfterSec: number } {
  const nowMs = params.nowMs ?? Date.now();
  const windowStart = nowMs - params.windowSec * 1000;

  const bucket = buckets.get(params.key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((ts) => ts >= windowStart);

  if (bucket.timestamps.length >= params.maxRequests) {
    const retryAfterMs = bucket.timestamps[0] + params.windowSec * 1000 - nowMs;
    buckets.set(params.key, bucket);
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000))
    };
  }

  bucket.timestamps.push(nowMs);
  buckets.set(params.key, bucket);
  return { allowed: true, retryAfterSec: 0 };
}

export function clearRateLimitState(): void {
  buckets.clear();
}
