# Liquid Glass Style Guide (Control Center)

How to reproduce the **liquid glass** widget look used by this extension’s Control Center. Follow this exactly when restyling existing tiles or adding new ones.

**Canonical implementation:** `stylesheet.css` (classes under `.macos-control-center-*`)  
**UI construction:** `lib/controlCenterIndicator.js`

---

## What “liquid glass” means here

Target look (macOS Control Center–inspired):

1. **Translucent fill** — wallpaper / content behind the widget shows through  
2. **Vertical highlight** — brighter at the top, quieter at the bottom (curved glass depth)  
3. **Bright rim** — thin white border, more opaque than the fill  
4. **Inset top edge** — a single light catch-line along the top inner edge  
5. **High corner radius** — pills fully rounded; cards ~20–22px  

It is a **CSS approximation**. True backdrop blur via `Shell.BlurEffect` is **intentionally not used** on the popup shell (see Hard rules).

---

## Hard rules (do not violate)

These caused gnome-shell crashes (logout / ABRT) on this project:

| Avoid | Why |
|--------|-----|
| `Shell.BlurEffect` on the popup / BoxPointer / `.popup-menu-content` | Clutter paint abort after screenshot UI / teardown (`clutter_actor_node_new: actor != NULL`) |
| `rotation_angle_y` / 3D flips on icons | Same Clutter paint-meta crash class |
| Heavy multi-layer `box-shadow` stacks (several inset + large outer shadows) | Associated with `clip: nan` / paint instability on some Mutter builds |
| Opaque theme chrome left on `.popup-menu-content` | Yaru/Adwaita paints solid `#36363a` — glass never shows until cleared |

**Safe motion:** 2D only — `scale_x` / `scale_y` / `opacity` via `actor.ease(...)`.

**Popup chrome:** outer menu + `.popup-menu-content` / `.macos-control-center-content` must stay **fully transparent** (`background-color: transparent; border: none; box-shadow: none`) so each widget’s glass sits on the desktop.

---

## Shared glass recipe (copy this)

Apply to every glass surface (pills, circles, media card, slider cards):

```css
.your-glass-widget {
  background-color: rgba(255, 255, 255, 0.12);
  background-gradient-direction: vertical;
  background-gradient-start: rgba(255, 255, 255, 0.28);
  background-gradient-end: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.42);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5);
}
```

### Token table (base)

| Token | Value | Role |
|-------|--------|------|
| Fill | `rgba(255, 255, 255, 0.12)` | Base frosted plate |
| Gradient start (top) | `rgba(255, 255, 255, 0.28)` | Specular / highlight |
| Gradient end (bottom) | `rgba(255, 255, 255, 0.08)` | Falloff |
| Border | `rgba(255, 255, 255, 0.42)` | Glass rim (brighter than fill) |
| Inset highlight | `inset 0 1px 0 rgba(255, 255, 255, 0.5)` | Top edge light catch |

### Hover (slightly brighter)

```css
.your-glass-widget:hover {
  background-color: rgba(255, 255, 255, 0.16);
  background-gradient-start: rgba(255, 255, 255, 0.36);
  background-gradient-end: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.55);
}
```

### Active / “on” (selected or enabled)

```css
.your-glass-widget.on {
  background-color: rgba(255, 255, 255, 0.22);
  background-gradient-start: rgba(255, 255, 255, 0.42);
  background-gradient-end: rgba(255, 255, 255, 0.16);
  border-color: rgba(255, 255, 255, 0.58);
}
```

Do **not** use solid system blue for “on” fills in this design — keep translucent white glass; accent belongs on glyphs only.

---

## Shape variants

| Widget | Radius | Notes |
|--------|--------|--------|
| Pill (Wi‑Fi, Bluetooth) | `border-radius: 999px` | Capsule; padding ~`10px 14px` |
| Circle button | `border-radius: 999px` + fixed `64×64` | Icon ~36px |
| Media / slider cards | `border-radius: 22px` | Rectangular glass panels |

### Slider cards (slightly denser / “sunken”)

Override the shared recipe with a quieter fill:

```css
.your-slider-card {
  /* …same border + inset shadow as shared recipe… */
  background-color: rgba(255, 255, 255, 0.1);
  background-gradient-start: rgba(255, 255, 255, 0.22);
  background-gradient-end: rgba(255, 255, 255, 0.06);
}
```

---

## Icon badges (pill leading icons)

Solid near-white disc; glyph uses the **user accent** from GNOME Settings:

```css
.your-pill-icon-badge {
  width: 30px;
  height: 30px;
  border-radius: 999px;
  background-color: rgba(255, 255, 255, 0.92);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9);
}

.your-pill-icon-badge StIcon {
  icon-size: 16px;
  color: -st-accent-color; /* Settings → Appearance accent */
}
```

---

## Typography on glass

| Role | Color |
|------|--------|
| Primary title | `white` / `rgba(255, 255, 255, 0.95–0.98)` |
| Secondary / subtitle | `rgba(255, 255, 255, 0.85–0.88)` |

Keep text near-opaque — translucent labels fail on busy wallpapers.

---

## GNOME Shell / St CSS notes

This stylesheet is **St CSS**, not browser CSS:

- Prefer `background-gradient-direction` / `background-gradient-start` / `background-gradient-end` over `linear-gradient(...)`.
- `spacing` is valid on `St.BoxLayout` style classes.
- Pseudo-classes like `:hover` work on reactive `St.Button`s.
- Custom state is applied in JS with `add_style_class_name('on')` / `remove_style_class_name('on')`.

### Transparent popup requirement

```css
.your-menu { background-color: transparent; border: none; box-shadow: none; }

.your-menu .popup-menu-content,
.your-menu-content {
  background-color: transparent;
  border: none;
  box-shadow: none;
}
```

Also neutralize wrapper `.popup-menu-item` hover washes so they don’t paint opaque gray over the glass.

---

## Interaction (keep crash-safe)

Press feedback (pills / circles):

- Pivot `0.5, 0.5`
- Ease `scale_x` / `scale_y` → `~0.9` then back to `1`
- Durations ~70ms in / ~160ms out
- Modes: `EASE_IN_QUAD` / `EASE_OUT_CUBIC`

Appearance “flip”:

- Use **horizontal** `scale_x` → `~0.05` → `1` (2D)
- Never `rotation_angle_y`

---

## Adding a new glass widget (checklist)

1. Clear popup chrome so the desktop shows through.  
2. Add the **shared glass recipe** to the widget’s style class.  
3. Pick a **shape variant** (pill / circle / card radius).  
4. Wire `:hover` and `.on` using the token steps above.  
5. Titles near-white; subtitles ~0.85 alpha.  
6. Accent only on symbolic glyphs (`-st-accent-color`), not on glass fills.  
7. Animate with **2D scale/opacity only**.  
8. Do **not** attach `Shell.BlurEffect` to the menu actor.

---

## Web / non-Shell ports (if needed)

If adapting outside GNOME Shell, map tokens like this:

```css
.glass {
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.28),
    rgba(255, 255, 255, 0.08)
  );
  background-color: rgba(255, 255, 255, 0.12); /* fallback */
  border: 1px solid rgba(255, 255, 255, 0.42);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5);
  border-radius: 22px; /* or 999px for pills */
  /* Optional where safe: backdrop-filter: blur(24px); */
}
```

In **this** extension, prefer the St properties in the shared recipe, and treat `backdrop-filter` / `Shell.BlurEffect` as out of scope unless crash-safe lifecycle handling is proven.

---

## Reference classes in this repo

| Class | Role |
|-------|------|
| `.macos-control-center-pill` | Wi‑Fi / Bluetooth capsules |
| `.macos-control-center-circle-button` | Screenshot / Appearance |
| `.macos-control-center-media-card` | Now-playing card |
| `.macos-control-center-slider-card` | Display / Volume |
| `.macos-control-center-pill-icon-badge` | Accent glyph disc |
| `.macos-control-center-content` | Transparent menu content plate |

When in doubt, copy the shared block from `stylesheet.css` and only change radius, padding, and the denser slider overrides.
