// Stage 2 — the two HTML overlays: a small hover info card, and a
// fuller focus detail panel. Both are plain positioned DOM, not 3D
// text meshes (see the Stage 1 design notes on why — crisp text is a
// solved problem in HTML, not worth fighting Three.js's font rendering
// for). Both restate only facts the dashboard below already states in
// text — src/lib/hall-view/format.ts's confirmedLabel()/remainingLabel()
// are the exact same formatting the dashboard uses, duplicated rather
// than imported (see format.ts's own note) so this module never touches
// the dashboard's existing, already-tested script.
import type { Machine } from "../types.ts";
import { confirmedLabel, remainingLabel } from "./format.ts";

const STATUS_LABELS: Record<Machine["status"], string> = {
  available: "Available",
  "in-use": "In use",
  "out-of-order": "Out of order",
  unknown: "Unknown",
};

function machineName(machine: Machine): string {
  return machine.type === "washer" ? "Washer" : "Dryer";
}

// Stage 3 fix — the hover card previously showed only "Washer"/"Dryer",
// with nothing saying which of the five rooms it belonged to. Now a
// five-room scene, two machines alone no longer identify which one a
// resident is looking at. Matches the dashboard's own existing "Block
// {location}" wording (src/pages/index.astro's zone-label) rather than
// inventing new copy for the same fact.
function roomLabel(machine: Machine): string {
  return `Block ${machine.location}`;
}

export interface RoomLabelSpec {
  id: string;
  text: string;
}

export interface OverlayHandle {
  /** Shows the small hover card near the given screen-space point, or hides it if machine is null. */
  showHover(machine: Machine | null, screenX: number, screenY: number): void;
  /** Shows the fuller focus detail panel for a machine anchored at the
   * given screen-space point (the machine's own HUD-bracket anchor,
   * projected by scene.ts), or hides it if machine is null. Stage 2.1
   * fix: previously had no position parameter at all and was pinned to
   * a fixed screen corner via CSS — now explicitly positioned every
   * frame so it tracks the machine (and the camera's focus tween) it's
   * actually meant to sit above. */
  showFocus(machine: Machine | null, screenX?: number, screenY?: number): void;
  /** Re-positions the already-shown focus panel without touching its
   * content — called every frame while focused, since the anchor point
   * moves during the camera's focus tween and must keep tracking it.
   * containerWidth/Height are the current container size, used to clamp
   * the panel on-screen (see positionFocusPanel's own note) — point 3 of
   * the Stage 2.2 framing fix: a screen-space clamp on this DOM overlay,
   * never a change to the 3D camera, is what handles whatever the focus
   * shot's own reserved-top framing doesn't exactly cover. */
  updateFocusPosition(screenX: number, screenY: number, containerWidth: number, containerHeight: number): void;
  dispose(): void;
}

export function createOverlay(container: HTMLElement, onCloseFocus: () => void): OverlayHandle {
  const hoverCard = document.createElement("div");
  hoverCard.className = "hall-hover-card";
  hoverCard.hidden = true;
  container.appendChild(hoverCard);

  const focusPanel = document.createElement("div");
  focusPanel.className = "hall-focus-panel";
  focusPanel.hidden = true;
  container.appendChild(focusPanel);

  function showHover(machine: Machine | null, screenX: number, screenY: number): void {
    if (!machine) {
      hoverCard.hidden = true;
      return;
    }
    const remaining = machine.status === "in-use" ? remainingLabel(machine.expectedEndAt) : null;
    hoverCard.innerHTML = `
      <div class="hall-hover-card__room">${roomLabel(machine)}</div>
      <div class="hall-hover-card__name">${machineName(machine)}</div>
      <div class="hall-hover-card__status hall-status--${machine.status}">${STATUS_LABELS[machine.status]}</div>
      <div class="hall-hover-card__meta">${confirmedLabel(machine.confirmedAt)}</div>
      ${remaining ? `<div class="hall-hover-card__meta">${remaining.text}</div>` : ""}
    `;
    hoverCard.hidden = false;
    // Positioned relative to the container, offset slightly up-right of
    // the pointer so the card never sits directly under the cursor.
    hoverCard.style.left = `${screenX + 16}px`;
    hoverCard.style.top = `${screenY - 12}px`;
  }

  // A small fixed margin from the container's own edges — the clamp
  // never lets the panel touch the container border exactly, same
  // spirit as the 3D framing's own small margins.
  const CLAMP_MARGIN_PX = 10;
  // The stem's length in real pixels, set once via inline style (below)
  // rather than left as the CSS's own rem-based --hall-stem-length
  // custom property — getComputedStyle().getPropertyValue() on a custom
  // property returns its raw authored value ("0.6rem") as a string, not
  // a resolved pixel length, so parsing it directly would silently
  // misread 0.6rem as 0.6px. Setting it here in JS, once, keeps the one
  // real number used for both the CSS variable and this module's own
  // clamp math exactly in sync without needing unit conversion at all.
  const STEM_LENGTH_PX = 10;
  focusPanel.style.setProperty("--hall-stem-length", `${STEM_LENGTH_PX}px`);

  // Stage 2.2 — positions the panel centered horizontally on the anchor
  // point and bottom-anchored just above it (anchor marks the top of
  // the HUD brackets, and the panel should sit above that, not straddle
  // it — see the CSS's own translate(-50%, calc(-100% - stem)) for how
  // that's expressed), THEN clamps the result within the container's
  // bounds using the panel's own actual rendered size (read fresh via
  // getBoundingClientRect(), not assumed) so it can never render
  // partially outside the visible frame. This is a pure screen-space
  // DOM adjustment — it never changes the 3D camera or scene to make
  // room, per the Stage 2.2 direction that the panel must not drive the
  // 3D framing. The 3D focus shot's own reserved-top rectangle
  // (interaction.ts's FOCUS_NDC_TOP) is the primary mechanism that
  // keeps this clamp from having to do much work in the common case;
  // this is the safety net for whatever that doesn't exactly cover.
  function positionFocusPanel(screenX: number, screenY: number, containerWidth: number, containerHeight: number): void {
    // Un-clamped size, before the clamp below might shift it — read via
    // the panel's own layout, since its height varies with content
    // (e.g. an in-use machine's extra "Remaining" row) and its width is
    // fixed by CSS, so neither should be hand-coded here.
    const rect = focusPanel.getBoundingClientRect();
    const panelWidth = rect.width;
    const panelHeight = rect.height;

    // The panel's natural (unclamped) top-left corner, given its CSS
    // transform of translate(-50%, calc(-100% - stem)) around (screenX,
    // screenY) — i.e. centered horizontally on screenX, with its
    // bottom (plus the stem) at screenY.
    const naturalLeft = screenX - panelWidth / 2;
    const naturalTop = screenY - panelHeight - STEM_LENGTH_PX;

    const clampedLeft = Math.min(
      Math.max(naturalLeft, CLAMP_MARGIN_PX),
      containerWidth - panelWidth - CLAMP_MARGIN_PX,
    );
    // Vertical clamp only ever pushes the panel DOWN (away from going
    // off the top) — the focus shot's reserved-top rectangle is what
    // keeps the anchor itself low enough that the panel doesn't also
    // need pushing up away from the bottom. If this clamp ever fires
    // (naturalTop < margin), the stem below visually stretches rather
    // than staying exactly its authored length — an acceptable trade
    // for "never rendered partially off-screen," and a rare case given
    // the 3D framing's own reservation handles the common one.
    const clampedTop = Math.max(naturalTop, CLAMP_MARGIN_PX);

    // Expressed as left/top directly (not through the screenX/screenY +
    // CSS-transform scheme the "natural" position uses), since a
    // clamped position may no longer be expressible as that transform
    // around the original anchor point — so the transform is neutralized
    // here and left/top become the panel's literal top-left corner.
    focusPanel.style.transform = "none";
    focusPanel.style.left = `${clampedLeft}px`;
    focusPanel.style.top = `${clampedTop}px`;
  }

  function showFocus(machine: Machine | null, screenX?: number, screenY?: number): void {
    if (!machine) {
      focusPanel.hidden = true;
      return;
    }
    const remaining = machine.status === "in-use" ? remainingLabel(machine.expectedEndAt) : null;
    focusPanel.innerHTML = `
      <button type="button" class="hall-focus-panel__close" aria-label="Close detail view">×</button>
      <div class="hall-focus-panel__header">
        <span class="hall-focus-panel__room">${roomLabel(machine)}</span>
        <span class="hall-focus-panel__name">${machineName(machine)}</span>
        <span class="hall-focus-panel__status hall-status--${machine.status}">${STATUS_LABELS[machine.status]}</span>
      </div>
      <dl class="hall-focus-panel__facts">
        <dt>Confirmed</dt><dd>${confirmedLabel(machine.confirmedAt)}</dd>
        ${remaining ? `<dt>Remaining</dt><dd>${remaining.text}</dd>` : ""}
      </dl>
    `;
    focusPanel.hidden = false;
    // showFocus's own initial call (from scene.ts's onFocusChange) omits
    // screenX/screenY — the very next updateFocusPosition() call (also
    // triggered synchronously from that same callback) supplies the
    // real, container-sized position immediately after, so this first
    // render is never actually visible un-positioned.
    if (screenX !== undefined && screenY !== undefined) {
      positionFocusPanel(screenX, screenY, container.clientWidth, container.clientHeight);
    }
    focusPanel.querySelector(".hall-focus-panel__close")?.addEventListener("click", onCloseFocus);
  }

  function updateFocusPosition(screenX: number, screenY: number, containerWidth: number, containerHeight: number): void {
    if (focusPanel.hidden) return;
    positionFocusPanel(screenX, screenY, containerWidth, containerHeight);
  }

  function dispose(): void {
    hoverCard.remove();
    focusPanel.remove();
  }

  return { showHover, showFocus, updateFocusPosition, dispose };
}
