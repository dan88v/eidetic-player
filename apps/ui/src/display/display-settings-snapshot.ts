import type { DisplaySnapshot } from "../../../../packages/shared/src/display";

export function displaySettingsPresentationChanged(
  previous: DisplaySnapshot,
  next: DisplaySnapshot,
): boolean {
  return (
    previous.state !== next.state ||
    previous.dimMethod !== next.dimMethod ||
    previous.standbyMethod !== next.standbyMethod ||
    previous.standbyAvailable !== next.standbyAvailable ||
    previous.standbyInhibitedReason !== next.standbyInhibitedReason ||
    previous.dimLevelPercent !== next.dimLevelPercent ||
    previous.testActive !== next.testActive ||
    previous.lastErrorCode !== next.lastErrorCode
  );
}
