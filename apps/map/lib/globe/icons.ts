"use client";
// Procedurally drawn HUD glyphs for billboards. Everything is generated on a
// canvas at runtime so the app ships no binary sprite assets. Cached by key.

export type IconKind =
  | "plane"
  | "heli"
  | "ship"
  | "sat"
  | "cam"
  | "pad"
  | "rocket"
  | "quake"
  | "car"
  | "dot"
  | "gauge"
  | "well"
  | "dam"
  | "chip"
  | "port"
  | "crossing"
  | "jobs"
  | "fire"
  | "hazard"
  | "volcano";

const cache = new Map<string, HTMLCanvasElement>();

export function iconKey(kind: IconKind, color: string, size = 32): string {
  return `${kind}:${color}:${size}`;
}

export function getIcon(kind: IconKind, color: string, size = 32): HTMLCanvasElement {
  const key = iconKey(kind, color, size);
  let c = cache.get(key);
  if (!c) {
    c = draw(kind, color, size);
    cache.set(key, c);
  }
  return c;
}

function draw(kind: IconKind, color: string, size: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const s = size / 32; // all paths are authored in a 32x32 box
  ctx.scale(s, s);
  ctx.translate(16, 16);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.fillStyle = color;
  ctx.lineWidth = 2;

  const path = new Path2D();
  switch (kind) {
    case "plane": {
      // nose up (north)
      path.moveTo(0, -13);
      path.lineTo(2.2, -8);
      path.lineTo(2.4, -3);
      path.lineTo(13, 3);
      path.lineTo(13, 5.5);
      path.lineTo(2.4, 2.5);
      path.lineTo(1.8, 8.5);
      path.lineTo(5.5, 11);
      path.lineTo(5.5, 12.5);
      path.lineTo(0, 11);
      path.lineTo(-5.5, 12.5);
      path.lineTo(-5.5, 11);
      path.lineTo(-1.8, 8.5);
      path.lineTo(-2.4, 2.5);
      path.lineTo(-13, 5.5);
      path.lineTo(-13, 3);
      path.lineTo(-2.4, -3);
      path.lineTo(-2.2, -8);
      path.closePath();
      break;
    }
    case "heli": {
      path.moveTo(0, -9);
      path.lineTo(4, -4);
      path.lineTo(4, 4);
      path.lineTo(1.5, 8);
      path.lineTo(1.5, 12);
      path.lineTo(-1.5, 12);
      path.lineTo(-1.5, 8);
      path.lineTo(-4, 4);
      path.lineTo(-4, -4);
      path.closePath();
      break;
    }
    case "ship": {
      path.moveTo(0, -12);
      path.lineTo(5, -3);
      path.lineTo(5, 10);
      path.lineTo(-5, 10);
      path.lineTo(-5, -3);
      path.closePath();
      break;
    }
    case "car": {
      path.moveTo(0, -6);
      path.lineTo(3.5, -2);
      path.lineTo(3.5, 6);
      path.lineTo(-3.5, 6);
      path.lineTo(-3.5, -2);
      path.closePath();
      break;
    }
    case "sat": {
      // body + two solar panels
      path.rect(-3, -3, 6, 6);
      path.rect(-14, -2, 8, 4);
      path.rect(6, -2, 8, 4);
      break;
    }
    case "cam": {
      // camera body with lens, looking right-ish
      path.moveTo(-11, -6);
      path.lineTo(5, -6);
      path.lineTo(5, -2);
      path.lineTo(12, -6);
      path.lineTo(12, 6);
      path.lineTo(5, 2);
      path.lineTo(5, 6);
      path.lineTo(-11, 6);
      path.closePath();
      break;
    }
    case "pad": {
      // launch pad: base + gantry
      path.rect(-10, 8, 20, 4);
      path.rect(-2, -12, 4, 20);
      path.rect(4, -8, 3, 16);
      break;
    }
    case "rocket": {
      path.moveTo(0, -14);
      path.lineTo(4, -6);
      path.lineTo(4, 8);
      path.lineTo(8, 13);
      path.lineTo(2, 11);
      path.lineTo(0, 14);
      path.lineTo(-2, 11);
      path.lineTo(-8, 13);
      path.lineTo(-4, 8);
      path.lineTo(-4, -6);
      path.closePath();
      break;
    }
    case "quake": {
      path.arc(0, 0, 12, 0, Math.PI * 2);
      ctx.stroke(path);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = color;
      ctx.stroke(path);
      const inner = new Path2D();
      inner.arc(0, 0, 4, 0, Math.PI * 2);
      ctx.fill(inner);
      return canvas;
    }
    case "gauge": {
      // water drop: a stream / reservoir gauge
      path.moveTo(0, -13);
      path.bezierCurveTo(6, -4, 10, 2, 10, 6);
      path.arc(0, 6, 10, 0, Math.PI, false);
      path.bezierCurveTo(-10, 2, -6, -4, 0, -13);
      path.closePath();
      break;
    }
    case "well": {
      // groundwater well: casing ring over a shaft
      path.rect(-2, -4, 4, 16);
      path.moveTo(9, -8);
      path.arc(0, -8, 9, 0, Math.PI * 2);
      break;
    }
    case "dam": {
      // dam wall: wide trapezoid with a crest
      path.moveTo(-12, 10);
      path.lineTo(-5, -10);
      path.lineTo(5, -10);
      path.lineTo(12, 10);
      path.closePath();
      path.rect(-7, -13, 14, 3);
      break;
    }
    case "chip": {
      // turbidity chip: a square swatch
      path.rect(-9, -9, 18, 18);
      break;
    }
    case "port": {
      // harbour: an anchor
      path.moveTo(0, -12);
      path.arc(0, -9, 3, -Math.PI / 2, (3 * Math.PI) / 2);
      path.rect(-1.3, -6, 2.6, 15);
      path.rect(-6, -4, 12, 2.2);
      path.moveTo(-11, 1);
      path.quadraticCurveTo(-10, 12, 0, 12);
      path.quadraticCurveTo(10, 12, 11, 1);
      path.lineTo(7.5, 1);
      path.quadraticCurveTo(7, 8.5, 0, 8.5);
      path.quadraticCurveTo(-7, 8.5, -7.5, 1);
      path.closePath();
      break;
    }
    case "crossing": {
      // land port of entry: a truck
      path.rect(-13, -6, 16, 11);
      path.moveTo(3, -2);
      path.lineTo(9, -2);
      path.lineTo(13, 3);
      path.lineTo(13, 5);
      path.lineTo(3, 5);
      path.closePath();
      path.moveTo(-6.5, 8);
      path.arc(-9, 8, 2.6, 0, Math.PI * 2);
      path.moveTo(11.6, 8);
      path.arc(9, 8, 2.6, 0, Math.PI * 2);
      break;
    }
    case "jobs": {
      // jobs & wages: three rising bars
      path.rect(-11, 1, 5.5, 10);
      path.rect(-2.75, -5, 5.5, 16);
      path.rect(5.5, -11, 5.5, 22);
      break;
    }
    case "fire": {
      // wildfire incident: a flame
      path.moveTo(0, -13);
      path.bezierCurveTo(4, -6, 10, -2, 9, 5);
      path.bezierCurveTo(8, 10, 4, 13, 0, 13);
      path.bezierCurveTo(-4, 13, -8, 10, -9, 5);
      path.bezierCurveTo(-10, 0, -6, -3, -4, -8);
      path.bezierCurveTo(-3, -4, -1, -3, 0, -13);
      path.closePath();
      break;
    }
    case "hazard": {
      // hazard alert: a warning triangle with a notch
      path.moveTo(0, -12);
      path.lineTo(12, 10);
      path.lineTo(-12, 10);
      path.closePath();
      ctx.stroke(path);
      ctx.fill(path);
      ctx.fillStyle = "rgba(0,0,0,0.85)";
      ctx.fillRect(-1.5, -4, 3, 8);
      ctx.fillRect(-1.5, 6, 3, 2.5);
      return canvas;
    }
    case "volcano": {
      // volcano: a cone with a vent plume
      path.moveTo(-13, 11);
      path.lineTo(-4, -5);
      path.lineTo(4, -5);
      path.lineTo(13, 11);
      path.closePath();
      path.moveTo(-2, -8);
      path.arc(-3, -10, 2.5, 0, Math.PI * 2);
      path.moveTo(4.5, -12);
      path.arc(2, -12, 2.5, 0, Math.PI * 2);
      break;
    }
    case "dot":
    default: {
      path.arc(0, 0, 5, 0, Math.PI * 2);
      break;
    }
  }
  ctx.stroke(path);
  ctx.fill(path);
  return canvas;
}

/** A soft radial glow used behind selected objects. */
export function getGlow(color: string, size = 64): HTMLCanvasElement {
  const key = `glow:${color}:${size}`;
  let c = cache.get(key);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  g.addColorStop(0, color);
  g.addColorStop(0.35, color + "80");
  g.addColorStop(1, color + "00");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  cache.set(key, c);
  return c;
}
