// Select XWayland only where native Wayland cannot discover a DRM device.
export function needsX11Fallback({ platform, hasDri, display, explicitOzone }) {
  return platform === 'linux' && !hasDri && Boolean(display) && !explicitOzone
}
