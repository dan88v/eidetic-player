import {
  isSystemPowerAction,
  type SystemPowerAction,
} from "../../../../packages/shared/src/system.js";

export class PowerActionError extends Error {
  constructor(
    readonly code:
      | "INVALID_POWER_ACTION"
      | "ACTION_NOT_AVAILABLE"
      | "ACTION_IN_PROGRESS"
      | "POWER_PREPARATION_FAILED",
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

export interface HostPowerActionAdapter {
  execute(action: SystemPowerAction): Promise<void>;
}

export function validatePowerActionBody(body: unknown): SystemPowerAction {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new PowerActionError(
      "INVALID_POWER_ACTION",
      "Invalid power action.",
      400,
    );
  const record = body as Record<string, unknown>;
  if (
    Object.keys(record).length !== 1 ||
    !Object.hasOwn(record, "action") ||
    !isSystemPowerAction(record.action)
  )
    throw new PowerActionError(
      "INVALID_POWER_ACTION",
      "Invalid power action.",
      400,
    );
  return record.action;
}

export class PowerActionCoordinator {
  private inProgress = false;

  constructor(
    private readonly availableActions: readonly SystemPowerAction[],
    private readonly flushSession: () => Promise<void>,
    private readonly adapter: HostPowerActionAdapter,
  ) {}

  async request(action: SystemPowerAction): Promise<void> {
    if (this.inProgress)
      throw new PowerActionError(
        "ACTION_IN_PROGRESS",
        "A system action is already in progress.",
        409,
      );
    if (!this.availableActions.includes(action))
      throw new PowerActionError(
        "ACTION_NOT_AVAILABLE",
        "This system action is unavailable.",
        409,
      );
    this.inProgress = true;
    try {
      await this.flushSession();
      await this.adapter.execute(action);
    } catch (error) {
      this.inProgress = false;
      if (error instanceof PowerActionError) throw error;
      throw new PowerActionError(
        "POWER_PREPARATION_FAILED",
        "The current session could not be saved.",
        500,
      );
    }
  }
}
