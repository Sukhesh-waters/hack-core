import type { ActivitySubjectType } from "@/lib/activity";

export type ContentStateChangedEvent = {
  verb: "content.state_changed";
  workspaceId: string;
  subjectType: "content";
  subjectId: string;
  actorId: string | null;
  from: string;
  to: string;
  meta?: Record<string, unknown>;
};

export type ContentPublishedEvent = {
  verb: "content.published";
  workspaceId: string;
  subjectType: "content";
  subjectId: string;
  actorId: string | null;
  channel?: string;
  meta?: Record<string, unknown>;
};

export type ContentScheduledEvent = {
  verb: "content.scheduled";
  workspaceId: string;
  subjectType: "content";
  subjectId: string;
  actorId: string | null;
  scheduledAt?: string | Date;
  meta?: Record<string, unknown>;
};

export type TicketClosedEvent = {
  verb: "ticket.closed";
  workspaceId: string;
  subjectType: "ticket";
  subjectId: string;
  actorId: string | null;
  meta?: Record<string, unknown>;
};

export type TicketReopenedEvent = {
  verb: "ticket.reopened";
  workspaceId: string;
  subjectType: "ticket";
  subjectId: string;
  actorId: string | null;
  meta?: Record<string, unknown>;
};

export type SopStepCompletedEvent = {
  verb: "sop_step.completed";
  workspaceId: string;
  subjectType: "sop_run_step";
  subjectId: string;
  runId: string;
  actorId: string | null;
  meta?: Record<string, unknown>;
};

export type SopStepAssignedEvent = {
  verb: "sop_step.assigned";
  workspaceId: string;
  subjectType: "sop_run_step";
  subjectId: string;
  runId: string;
  actorId: string | null;
  meta?: Record<string, unknown>;
};

export type SopStepSlippedEvent = {
  verb: "sop_step.slipped";
  workspaceId: string;
  subjectType: "sop_run_step";
  subjectId: string;
  runId: string;
  targetDueAt?: string | Date;
  actorId: string | null;
  meta?: Record<string, unknown>;
};

export type ApprovalDecidedEvent = {
  verb: "approval.decided";
  workspaceId: string;
  subjectType: "hub_approval" | "content";
  subjectId: string;
  decision: "approved" | "rejected";
  actorId: string | null;
  meta?: Record<string, unknown>;
};

export type SlotScheduledEvent = {
  verb: "slot.scheduled";
  workspaceId: string;
  subjectType: "content";
  subjectId: string;
  slotDate?: string | Date;
  actorId: string | null;
  meta?: Record<string, unknown>;
};

export type GenericDomainEvent = {
  verb: string;
  workspaceId: string;
  subjectType: ActivitySubjectType;
  subjectId: string;
  actorId: string | null;
  meta?: Record<string, unknown>;
};

export type DomainEvent =
  | ContentStateChangedEvent
  | ContentPublishedEvent
  | ContentScheduledEvent
  | TicketClosedEvent
  | TicketReopenedEvent
  | SopStepCompletedEvent
  | SopStepAssignedEvent
  | SopStepSlippedEvent
  | ApprovalDecidedEvent
  | SlotScheduledEvent
  | GenericDomainEvent;
