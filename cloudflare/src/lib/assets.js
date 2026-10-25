const VERSION = "m1";

export function asset(relative) {
  const clean = relative.startsWith("/") ? relative : `/${relative}`;
  return `${clean}?v=${VERSION}`;
}
