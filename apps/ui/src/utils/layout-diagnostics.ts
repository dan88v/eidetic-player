function bounds(root: HTMLElement, selector: string): DOMRect | null {
  return (
    root.querySelector<HTMLElement>(selector)?.getBoundingClientRect() ?? null
  );
}

function gap(left: DOMRect | null, right: DOMRect | null): number | null {
  return left && right ? right.left - left.right : null;
}

export function recordNowPlayingLayout(root: HTMLElement): void {
  const volumeTrigger = root.querySelector<HTMLButtonElement>(
    '[data-control="volume"]',
  );
  if (
    new URLSearchParams(window.location.search).get("diagnosticOverlay") ===
    "volume"
  )
    volumeTrigger?.click();
  if (
    new URLSearchParams(window.location.search).get("diagnosticOverlay") ===
    "queue"
  )
    root.querySelector<HTMLButtonElement>('[data-control="queue"]')?.click();
  if (
    new URLSearchParams(window.location.search).get("diagnosticScreen") ===
    "library"
  )
    root.querySelector<HTMLButtonElement>('[data-control="library"]')?.click();

  const shuffle = bounds(root, '[data-control="shuffle"]');
  const previous = bounds(root, '[data-control="previous"]');
  const play = bounds(root, '[data-control="play"]');
  const next = bounds(root, '[data-control="next"]');
  const repeat = bounds(root, '[data-control="repeat"]');
  const artwork = bounds(root, ".now-playing__artwork");
  const canvas = root.querySelector<HTMLCanvasElement>(".visualizer__canvas");
  const canvasBounds = canvas?.getBoundingClientRect() ?? null;
  const graphicBottomOffset = Number(
    canvas?.dataset.meterGraphicBottomOffset ?? 0,
  );
  const time = root.querySelector<HTMLElement>(".timeline__time");
  const volumePopover = bounds(root, ".volume-popover--open");

  root.dataset.layoutDiagnostics = JSON.stringify({
    viewport: [window.innerWidth, window.innerHeight],
    viewportCenter: window.innerWidth / 2,
    playCenter: play ? play.left + play.width / 2 : null,
    centerDifference: play
      ? Math.abs(window.innerWidth / 2 - (play.left + play.width / 2))
      : null,
    gaps: {
      shufflePrevious: gap(shuffle, previous),
      previousPlay: gap(previous, play),
      playNext: gap(play, next),
      nextRepeat: gap(next, repeat),
    },
    meter: {
      barHeight: Number(canvas?.dataset.meterBarHeight ?? 16),
      rowGap: Number(canvas?.dataset.meterRowGap ?? 10),
      artworkBottom: artwork?.bottom ?? null,
      graphicBottom: canvasBounds
        ? canvasBounds.bottom - graphicBottomOffset
        : null,
    },
    timelineFontSize: time ? getComputedStyle(time).fontSize : null,
    volumePopover: volumePopover
      ? {
          left: volumePopover.left,
          top: volumePopover.top,
          width: volumePopover.width,
          height: volumePopover.height,
          bottom: volumePopover.bottom,
          aboveTrigger: volumeTrigger
            ? volumePopover.bottom <= volumeTrigger.getBoundingClientRect().top
            : null,
          inViewport:
            volumePopover.left >= 0 &&
            volumePopover.top >= 0 &&
            volumePopover.right <= window.innerWidth &&
            volumePopover.bottom <= window.innerHeight,
          overlapsPlay: play
            ? !(
                volumePopover.right <= play.left ||
                volumePopover.left >= play.right ||
                volumePopover.bottom <= play.top ||
                volumePopover.top >= play.bottom
              )
            : null,
        }
      : null,
    horizontalOverflow:
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  });
}
