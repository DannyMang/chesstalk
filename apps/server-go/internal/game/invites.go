package game

import (
	"sync"
	"time"
)

type Invite struct {
	UserID       string
	Sender       Sender
	OpponentInfo OpponentInfo
	Mode         string
	TimeControl  TimeControl
	CreatedAt    time.Time
}

type PendingInvite struct {
	UserID      string
	Mode        string
	TimeControl TimeControl
}

type InviteJoinResult struct {
	Matched bool
	Reason  string
	Game    *Actor
	Self    PairedSide
	Other   PairedSide
}

type InviteRegistry struct {
	mu           sync.Mutex
	invites      map[string]Invite
	userToInvite map[string]string
}

func NewInviteRegistry() *InviteRegistry {
	return &InviteRegistry{
		invites:      make(map[string]Invite),
		userToInvite: make(map[string]string),
	}
}

func (r *InviteRegistry) Create(userID string, sender Sender, mode string, tc TimeControl, info OpponentInfo) string {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.leaveByUserLocked(userID)
	inviteID := randomID()
	r.invites[inviteID] = Invite{
		UserID:       userID,
		Sender:       sender,
		OpponentInfo: info,
		Mode:         mode,
		TimeControl:  tc,
		CreatedAt:    time.Now(),
	}
	r.userToInvite[userID] = inviteID
	return inviteID
}

func (r *InviteRegistry) Peek(inviteID string) (PendingInvite, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	invite, ok := r.invites[inviteID]
	if !ok {
		return PendingInvite{}, false
	}
	return PendingInvite{UserID: invite.UserID, Mode: invite.Mode, TimeControl: invite.TimeControl}, true
}

func (r *InviteRegistry) Join(inviteID string, userID string, sender Sender, info OpponentInfo) InviteJoinResult {
	r.mu.Lock()
	defer r.mu.Unlock()

	invite, ok := r.invites[inviteID]
	if !ok {
		return InviteJoinResult{Reason: "not_found"}
	}
	if invite.UserID == userID {
		return InviteJoinResult{Reason: "self_join"}
	}

	delete(r.invites, inviteID)
	delete(r.userToInvite, invite.UserID)
	r.leaveByUserLocked(userID)

	newcomer := &Waiter{
		UserID:       userID,
		Sender:       sender,
		OpponentInfo: info,
		Mode:         invite.Mode,
		TimeControl:  invite.TimeControl,
	}
	peer := &Waiter{
		UserID:       invite.UserID,
		Sender:       invite.Sender,
		OpponentInfo: invite.OpponentInfo,
		Mode:         invite.Mode,
		TimeControl:  invite.TimeControl,
	}
	result := pairPlayers(newcomer, peer, invite.Mode, invite.TimeControl)

	return InviteJoinResult{
		Matched: true,
		Game:    result.Game,
		Self:    result.Self,
		Other:   result.Other,
	}
}

func (r *InviteRegistry) LeaveByUser(userID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.leaveByUserLocked(userID)
}

func (r *InviteRegistry) leaveByUserLocked(userID string) {
	inviteID := r.userToInvite[userID]
	if inviteID == "" {
		return
	}
	invite, ok := r.invites[inviteID]
	if ok && invite.UserID == userID {
		delete(r.invites, inviteID)
	}
	delete(r.userToInvite, userID)
}
