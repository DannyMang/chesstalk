import { Color, type Mode, type TimeControl } from "@chesstalk/shared/enums";
import type { OpponentInfo } from "@chesstalk/shared/wire";
import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import { GameActor } from "./game-actor.ts";

interface Invite {
  userId: string;
  ws: WebSocket;
  opponentInfo: OpponentInfo;
  mode: Mode;
  timeControl: TimeControl;
}

export interface PendingInvite {
  userId: string;
  mode: Mode;
  timeControl: TimeControl;
}

interface PairedSide {
  userId: string;
  ws: WebSocket;
  color: Color;
  opponent: OpponentInfo;
}

export interface InviteMatchResult {
  matched: true;
  game: GameActor;
  self: PairedSide;
  other: PairedSide;
}

export type JoinInviteResult =
  | { matched: false; reason: "not_found" | "self_join" }
  | InviteMatchResult;

export class InviteRegistry {
  private readonly invites: Map<string, Invite> = new Map();
  private readonly userToInvite: Map<string, string> = new Map();

  create(
    userId: string,
    ws: WebSocket,
    mode: Mode,
    timeControl: TimeControl,
    opponentInfo: OpponentInfo,
  ): string {
    this.leaveByUser(userId);

    const inviteId = randomUUID();
    this.invites.set(inviteId, {
      userId,
      ws,
      opponentInfo,
      mode,
      timeControl,
    });
    this.userToInvite.set(userId, inviteId);
    return inviteId;
  }

  peek(inviteId: string): PendingInvite | null {
    const invite = this.invites.get(inviteId);
    if (!invite) return null;
    return {
      userId: invite.userId,
      mode: invite.mode,
      timeControl: invite.timeControl,
    };
  }

  join(
    inviteId: string,
    userId: string,
    ws: WebSocket,
    opponentInfo: OpponentInfo,
  ): JoinInviteResult {
    const invite = this.invites.get(inviteId);
    if (!invite) return { matched: false, reason: "not_found" };
    if (invite.userId === userId) return { matched: false, reason: "self_join" };

    this.invites.delete(inviteId);
    this.userToInvite.delete(invite.userId);
    this.leaveByUser(userId);

    const now = Date.now();
    const joinerIsWhite = Math.random() < 0.5;
    const whiteSide = joinerIsWhite
      ? { userId, ws, info: opponentInfo }
      : { userId: invite.userId, ws: invite.ws, info: invite.opponentInfo };
    const blackSide = joinerIsWhite
      ? { userId: invite.userId, ws: invite.ws, info: invite.opponentInfo }
      : { userId, ws, info: opponentInfo };

    const game = new GameActor({
      id: randomUUID(),
      mode: invite.mode,
      timeControl: invite.timeControl,
      white: {
        userId: whiteSide.info.userId,
        username: whiteSide.info.username,
        ratingBefore: whiteSide.info.rating,
        ratingAfter: null,
      },
      black: {
        userId: blackSide.info.userId,
        username: blackSide.info.username,
        ratingBefore: blackSide.info.rating,
        ratingAfter: null,
      },
      now,
    });

    const joinerColor: Color = joinerIsWhite ? Color.White : Color.Black;
    const inviterColor: Color = joinerIsWhite ? Color.Black : Color.White;

    return {
      matched: true,
      game,
      self: {
        userId,
        ws,
        color: joinerColor,
        opponent: invite.opponentInfo,
      },
      other: {
        userId: invite.userId,
        ws: invite.ws,
        color: inviterColor,
        opponent: opponentInfo,
      },
    };
  }

  leaveByUser(userId: string): void {
    const inviteId = this.userToInvite.get(userId);
    if (!inviteId) return;
    const invite = this.invites.get(inviteId);
    if (invite?.userId === userId) {
      this.invites.delete(inviteId);
    }
    this.userToInvite.delete(userId);
  }
}

export const inviteRegistry = new InviteRegistry();
