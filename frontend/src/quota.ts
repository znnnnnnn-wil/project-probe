import type { Shop, Quota } from "./types";

export function trainingQuota(shop?: Shop | null): Quota {
  if (shop?.quota) return shop.quota;
  let sharedRemaining = 0,
    legacyDeepRemaining = 0,
    legacyRetestRemaining = 0;
  let unlimited = false;
  for (const pack of shop?.packages || []) {
    if (pack.lifetime) unlimited = true;
    else if (pack.product_code && pack.product_code !== "LEGACY_PAIR")
      sharedRemaining += Math.max(
        0,
        (pack.training_limit || 0) - (pack.training_used || 0),
      );
    else {
      if (!pack.deep_used) legacyDeepRemaining++;
      if (!pack.retest_used) legacyRetestRemaining++;
    }
  }
  return {
    unlimited,
    sharedRemaining,
    legacyDeepRemaining,
    legacyRetestRemaining,
    deepAvailable: sharedRemaining + legacyDeepRemaining,
    retestAvailable: sharedRemaining + legacyRetestRemaining,
  };
}
