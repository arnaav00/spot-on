import { Database, get, onDisconnect, onValue, ref, remove, runTransaction, set, Unsubscribe } from "firebase/database";
import { logError, logEvent, logWarn, shortId } from "./debug";
import { buildDeck, sanitizeExpansionIds } from "./expansions";

export type Phase = "lobby" | "submitting" | "ranking" | "reveal" | "intermission" | "finished";

export type Player = {
  id: string;
  name: string;
  initials: string;
  score: number;
  hand: string[];
  submitted: boolean;
};

export type RankedCard = { id: string; word: string; playerId: string };

export type Room = {
  code: string;
  hostId: string;
  phase: Phase;
  players: Record<string, Player>;
  playerOrder: string[];
  rankerId: string | null;
  roundIndex: number;
  gameNumber: number;
  totalGames: number;
  expansionIds: string[];
  nextGameAt?: number;
  presence?: Record<string, Record<string, boolean>>;
  deck: string[];
  discard: string[];
  submissions: Record<string, string[]>;
  ranking: RankedCard[];
  revealedCount: number;
  readyPlayers: Record<string, boolean>;
  reshuffledPlayers: Record<string, boolean>;
  scoreAnimationAt?: number;
  notice?: { id: string; message: string; at: number };
  createdAt: number;
  lastActiveAt: number;
};

const shuffle = <T,>(items: readonly T[]) => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

const cleanName = (name: string) => name.trim().replace(/\s+/g, " ").slice(0, 15);
const cleanInitials = (initials: string) => initials.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
const normalizeTotalGames = (totalGames?: number) => Math.max(1, Math.min(5, Math.round(totalGames ?? 3)));
const cloneRoom = (room: Room) => JSON.parse(JSON.stringify(room)) as Room;
const touch = (room: Room) => { room.lastActiveAt = Date.now(); return room; };

const roomSummary = (room: Room | null) => room ? {
  code: room.code,
  phase: room.phase,
  players: room.playerOrder?.length ?? Object.keys(room.players ?? {}).length,
  round: room.roundIndex,
  rankerId: shortId(room.rankerId),
} : { exists: false };

export function listenToRoom(db: Database, code: string, callback: (room: Room | null) => void): Unsubscribe {
  logEvent("room.listen.start", { code });
  return onValue(ref(db, `rooms/${code}`), (snapshot) => {
    const room = snapshot.val() as Room | null;
    if (!room) {
      logWarn("room.listen.missing", { code });
      return callback(null);
    }
    room.playerOrder ??= Object.keys(room.players ?? {});
    room.deck ??= [];
    room.discard ??= [];
    room.submissions ??= {};
    room.ranking ??= [];
    room.revealedCount ??= 0;
    room.readyPlayers ??= {};
    room.reshuffledPlayers ??= {};
    room.lastActiveAt ??= room.createdAt;
    room.totalGames = normalizeTotalGames(room.totalGames);
    room.expansionIds = sanitizeExpansionIds(room.expansionIds ?? []);
    room.playerOrder.forEach((id) => {
      room.players[id].initials ??= room.players[id].name.split(/\s+/).map((part) => part[0]).join("").slice(0, 3).toUpperCase();
      room.players[id].hand ??= [];
      room.players[id].score ??= 0;
      room.players[id].submitted ??= false;
    });
    logEvent("room.listen.snapshot", roomSummary(room));
    callback(room);
  }, (error) => logError("room.listen.error", error, { code }));
}

export async function createRoom(db: Database, code: string, playerId: string, name: string, initials: string) {
  logEvent("room.create.request", { code, playerId: shortId(playerId), name: cleanName(name) });
  const roomRef = ref(db, `rooms/${code}`);
  const result = await runTransaction(roomRef, (existing) => {
    if (existing) return;
    const player: Player = { id: playerId, name: cleanName(name), initials: cleanInitials(initials), score: 0, hand: [], submitted: false };
    return {
      code,
      hostId: playerId,
      phase: "lobby",
      players: { [playerId]: player },
      playerOrder: [playerId],
      rankerId: null,
      roundIndex: 0,
      gameNumber: 1,
      totalGames: 3,
      expansionIds: [],
      deck: buildDeck(),
      discard: [],
      submissions: {},
      ranking: [],
      revealedCount: 0,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      readyPlayers: {},
      reshuffledPlayers: {},
    } satisfies Room;
  }, { applyLocally: false });
  logEvent("room.create.result", { code, committed: result.committed, serverRoom: roomSummary(result.snapshot.val()) });
  if (!result.committed) {
    logWarn("room.create.rejected", { code });
    throw new Error("That room code was just taken. Please try again.");
  }
  const serverCheck = await get(roomRef);
  logEvent("room.create.verified", { code, exists: serverCheck.exists(), serverRoom: roomSummary(serverCheck.val()) });
  if (!serverCheck.exists()) throw new Error("Firebase did not persist the room. Refresh and try creating it again.");
}

export async function setTotalGames(db: Database, code: string, playerId: string, totalGames: number) {
  const nextTotal = normalizeTotalGames(totalGames);
  logEvent("room.games.request", { code, playerId: shortId(playerId), totalGames: nextTotal });
  const result = await runTransaction(ref(db, `rooms/${code}`), (room: Room | null) => {
    if (!room || room.phase !== "lobby" || room.hostId !== playerId) return;
    room.totalGames = nextTotal;
    return touch(room);
  }, { applyLocally: false });
  if (!result.committed) throw new Error("Only the host can change the number of games.");
}

export async function setExpansions(db: Database, code: string, playerId: string, expansionIds: string[]) {
  const selectedIds = sanitizeExpansionIds(expansionIds);
  logEvent("room.expansions.request", { code, playerId: shortId(playerId), expansionIds: selectedIds });
  const result = await runTransaction(ref(db, `rooms/${code}`), (room: Room | null) => {
    if (!room || room.phase !== "lobby" || room.hostId !== playerId) return;
    room.expansionIds = selectedIds;
    room.discard ??= [];
    const discarded = new Set(room.discard);
    room.deck = buildDeck(selectedIds).filter((word) => !discarded.has(word));
    return touch(room);
  }, { applyLocally: false });
  if (!result.committed) throw new Error("Only the host can choose expansions.");
}

export async function joinRoom(db: Database, code: string, playerId: string, name: string, initials: string) {
  logEvent("room.join.request", { code, playerId: shortId(playerId), name: cleanName(name) });
  let error = "Unable to join that room.";
  const roomRef = ref(db, `rooms/${code}`);
  const initial = await get(roomRef);
  logEvent("room.join.preflight", { code, exists: initial.exists(), serverRoom: roomSummary(initial.val()) });
  if (!initial.exists()) {
    logWarn("room.join.missing", { code });
    throw new Error("Room not found.");
  }
  const confirmedRoom = initial.val() as Room;
  let transactionAttempt = 0;
  const result = await runTransaction(roomRef, (currentRoom: Room | null) => {
    transactionAttempt += 1;
    const room = currentRoom ?? (transactionAttempt === 1 ? cloneRoom(confirmedRoom) : null);
    if (!currentRoom && transactionAttempt === 1) {
      logWarn("room.join.cache_hydrated", { code, transactionAttempt });
    }
    if (!room) { error = "Room not found. Check the code and try again."; return; }
    room.playerOrder ??= Object.keys(room.players ?? {});
    if (room.phase !== "lobby") { error = "That game has already started."; return; }
    if (room.playerOrder.length >= 6 && !room.players[playerId]) { error = "That room is full."; return; }
    if (!room.players[playerId]) room.playerOrder.push(playerId);
    room.players[playerId] = {
      id: playerId,
      name: cleanName(name),
      initials: cleanInitials(initials),
      score: room.players[playerId]?.score ?? 0,
      hand: [],
      submitted: false,
    };
    return touch(room);
  }, { applyLocally: false });
  logEvent("room.join.result", { code, committed: result.committed, transactionAttempts: transactionAttempt, serverRoom: roomSummary(result.snapshot.val()) });
  if (!result.committed) throw new Error(error);
}

const dealForRound = (room: Room, rankerId: string) => {
  room.submissions = {};
  room.ranking = [];
  room.revealedCount = 0;
  room.readyPlayers = {};
  for (const id of room.playerOrder) {
    const player = room.players[id];
    player.hand ??= [];
    player.submitted = false;
    if (id === rankerId) { player.hand = []; continue; }
    while (player.hand.length < 4 && room.deck.length) player.hand.push(room.deck.shift()!);
  }
  room.phase = "submitting";
};

export async function startGame(db: Database, code: string, playerId: string) {
  logEvent("game.start.request", { code, playerId: shortId(playerId) });
  let error = "Could not start the game.";
  const result = await runTransaction(ref(db, `rooms/${code}`), (room: Room | null) => {
    if (!room || room.hostId !== playerId || room.phase !== "lobby") return;
    if (room.playerOrder.length < 3) { error = "You need at least 3 players."; return; }
    room.totalGames = normalizeTotalGames(room.totalGames);
    room.expansionIds = sanitizeExpansionIds(room.expansionIds ?? []);
    room.rankerId = room.playerOrder[1];
    room.roundIndex = 0;
    room.reshuffledPlayers = {};
    dealForRound(room, room.rankerId);
    return touch(room);
  }, { applyLocally: false });
  logEvent("game.start.result", { code, committed: result.committed, serverRoom: roomSummary(result.snapshot.val()) });
  if (!result.committed) throw new Error(error);
}

export async function submitCards(db: Database, code: string, playerId: string, selected: string[]) {
  logEvent("cards.submit.request", { code, playerId: shortId(playerId), cardCount: selected.length });
  let error = "Could not submit those cards.";
  const result = await runTransaction(ref(db, `rooms/${code}`), (room: Room | null) => {
    if (!room || room.phase !== "submitting" || room.rankerId === playerId) return;
    room.submissions ??= {};
    room.ranking ??= [];
    room.players[playerId].hand ??= [];
    const required = room.playerOrder.length <= 4 ? 2 : 1;
    if (selected.length !== required || selected.some((word) => !room.players[playerId]?.hand.includes(word))) {
      error = `Choose exactly ${required} card${required > 1 ? "s" : ""}.`;
      return;
    }
    room.submissions[playerId] = selected;
    room.players[playerId].hand = room.players[playerId].hand.filter((word) => !selected.includes(word));
    room.players[playerId].submitted = true;
    const submitters = room.playerOrder.filter((id) => id !== room.rankerId);
    if (submitters.every((id) => room.players[id].submitted)) {
      room.ranking = shuffle(submitters.flatMap((id) => room.submissions[id].map((word, index) => ({ id: `${id}-${index}-${word}`, word, playerId: id }))));
      room.phase = "ranking";
    }
    return touch(room);
  }, { applyLocally: false });
  logEvent("cards.submit.result", { code, playerId: shortId(playerId), committed: result.committed, phase: result.snapshot.val()?.phase });
  if (!result.committed) throw new Error(error);
}

export async function reshuffleHand(db: Database, code: string, playerId: string) {
  logEvent("cards.reshuffle.request", { code, playerId: shortId(playerId) });
  let error = "That hand could not be reshuffled.";
  const result = await runTransaction(ref(db, `rooms/${code}`), (room: Room | null) => {
    if (!room || room.phase !== "submitting" || room.rankerId === playerId || !room.playerOrder.includes(playerId)) return;
    const player = room.players[playerId];
    if (!player || player.submitted) return;
    room.reshuffledPlayers ??= {};
    if (room.reshuffledPlayers[playerId]) { error = "You have already reshuffled this game."; return; }
    room.deck ??= [];
    room.discard ??= [];
    player.hand ??= [];
    if (room.deck.length < 4) { error = "There are not enough fresh cards to reshuffle."; return; }
    room.discard.push(...player.hand);
    player.hand = room.deck.splice(0, 4);
    room.reshuffledPlayers[playerId] = true;
    return touch(room);
  }, { applyLocally: false });
  logEvent("cards.reshuffle.result", { code, playerId: shortId(playerId), committed: result.committed });
  if (!result.committed) throw new Error(error);
}

export async function submitRanking(db: Database, code: string, playerId: string, ranking: RankedCard[]) {
  logEvent("ranking.submit.request", { code, playerId: shortId(playerId), cardCount: ranking.length });
  const result = await runTransaction(ref(db, `rooms/${code}`), (room: Room | null) => {
    if (!room || room.phase !== "ranking" || room.rankerId !== playerId) return;
    room.ranking ??= [];
    const expected = [...room.ranking].map((card) => card.id).sort().join("|");
    const received = [...ranking].map((card) => card.id).sort().join("|");
    if (expected !== received) return;
    room.ranking = ranking;
    room.discard ??= [];
    room.discard.push(...ranking.map((card) => card.word));
    room.phase = "reveal";
    room.revealedCount = 0;
    room.readyPlayers = {};
    return touch(room);
  }, { applyLocally: false });
  logEvent("ranking.submit.result", { code, committed: result.committed, phase: result.snapshot.val()?.phase });
  if (!result.committed) throw new Error("The ranking could not be saved.");
}

export async function revealNext(db: Database, code: string) {
  logEvent("reveal.next.request", { code });
  const result = await runTransaction(ref(db, `rooms/${code}`), (room: Room | null) => {
    if (!room || room.phase !== "reveal" || room.revealedCount >= room.ranking.length) return;
    room.revealedCount += 1;
    return touch(room);
  });
  logEvent("reveal.next.result", { code, committed: result.committed, revealedCount: result.snapshot.val()?.revealedCount });
}

const advanceRound = (room: Room) => {
    delete room.scoreAnimationAt;
    if (room.roundIndex + 1 >= room.playerOrder.length) {
      room.totalGames = normalizeTotalGames(room.totalGames);
      if (room.gameNumber < room.totalGames) {
        room.gameNumber += 1;
        room.phase = "intermission";
        room.nextGameAt = Date.now() + 3000;
      } else {
        room.phase = "finished";
        delete room.nextGameAt;
      }
      return;
    }
    const passedHands: Record<string, string[]> = {};
    room.playerOrder.forEach((sourceId, index) => {
      const targetId = room.playerOrder[(index + 1) % room.playerOrder.length];
      passedHands[targetId] = [...(room.players[sourceId].hand ?? [])];
    });
    room.playerOrder.forEach((id) => { room.players[id].hand = passedHands[id] ?? []; });
    const currentIndex = room.playerOrder.indexOf(room.rankerId!);
    room.rankerId = room.playerOrder[(currentIndex + 1) % room.playerOrder.length];
    room.roundIndex += 1;
    dealForRound(room, room.rankerId);
};

const beginScoreAnimation = (room: Room) => {
  if (room.scoreAnimationAt) return;
  room.ranking.forEach((card, index) => {
    if (room.players[card.playerId]) room.players[card.playerId].score += room.ranking.length - index;
  });
  room.scoreAnimationAt = Date.now();
};

export async function markReady(db: Database, code: string, playerId: string) {
  logEvent("round.ready.request", { code, playerId: shortId(playerId) });
  const result = await runTransaction(ref(db, `rooms/${code}`), (room: Room | null) => {
    if (!room || room.phase !== "reveal" || room.revealedCount < room.ranking.length || !room.playerOrder.includes(playerId)) return;
    room.readyPlayers ??= {};
    room.readyPlayers[playerId] = true;
    room.lastActiveAt = Date.now();
    if (room.playerOrder.every((id) => room.readyPlayers[id])) beginScoreAnimation(room);
    return touch(room);
  }, { applyLocally: false });
  logEvent("round.ready.result", { code, playerId: shortId(playerId), committed: result.committed, serverRoom: roomSummary(result.snapshot.val()) });
  if (!result.committed) throw new Error("Your ready status could not be saved.");
}

export async function finishReadyRound(db: Database, code: string) {
  logEvent("round.advance.request", { code });
  const result = await runTransaction(ref(db, `rooms/${code}`), (room: Room | null) => {
    if (!room || room.phase !== "reveal" || !room.scoreAnimationAt || !room.playerOrder.every((id) => room.readyPlayers?.[id])) return;
    advanceRound(room);
    return touch(room);
  }, { applyLocally: false });
  logEvent("round.advance.result", { code, committed: result.committed, serverRoom: roomSummary(result.snapshot.val()) });
}

const prepareGame = (room: Room) => {
  Object.keys(room.players).forEach((id) => { if (!room.playerOrder.includes(id)) delete room.players[id]; });
  const unusedHands = room.playerOrder.flatMap((id) => room.players[id]?.hand ?? []);
  room.deck = shuffle([...(room.deck ?? []), ...unusedHands]);
  room.playerOrder.forEach((id) => { room.players[id].hand = []; room.players[id].submitted = false; });
  room.roundIndex = 0;
  room.reshuffledPlayers = {};
  room.rankerId = room.playerOrder[room.gameNumber % room.playerOrder.length];
  delete room.nextGameAt;
  dealForRound(room, room.rankerId);
};

export async function beginNextGame(db: Database, code: string, playerId: string) {
  logEvent("game.intermission.complete.request", { code, playerId: shortId(playerId) });
  const result = await runTransaction(ref(db, `rooms/${code}`), (room: Room | null) => {
    if (!room || room.phase !== "intermission" || room.hostId !== playerId || Date.now() + 100 < (room.nextGameAt ?? 0)) return;
    prepareGame(room);
    return touch(room);
  }, { applyLocally: false });
  logEvent("game.intermission.complete.result", { code, committed: result.committed, gameNumber: result.snapshot.val()?.gameNumber });
}

export async function newGame(db: Database, code: string, playerId: string) {
  logEvent("game.return_to_lobby.request", { code, playerId: shortId(playerId) });
  const result = await runTransaction(ref(db, `rooms/${code}`), (room: Room | null) => {
    if (!room || room.phase !== "finished" || room.hostId !== playerId) return;
    room.players ??= {};
    room.playerOrder ??= Object.keys(room.players);
    Object.keys(room.players).forEach((id) => { if (!room.playerOrder.includes(id)) delete room.players[id]; });
    const unusedHands = room.playerOrder.flatMap((id) => room.players[id]?.hand ?? []);
    room.deck = shuffle([...(room.deck ?? []), ...unusedHands]);
    room.playerOrder.forEach((id) => {
      room.players[id].hand = [];
      room.players[id].submitted = false;
      room.players[id].score = 0;
    });
    room.gameNumber = 1;
    room.roundIndex = 0;
    room.rankerId = null;
    room.submissions = {};
    room.ranking = [];
    room.revealedCount = 0;
    room.readyPlayers = {};
    room.reshuffledPlayers = {};
    room.phase = "lobby";
    delete room.scoreAnimationAt;
    delete room.nextGameAt;
    return touch(room);
  }, { applyLocally: false });
  logEvent("game.return_to_lobby.result", { code, committed: result.committed, phase: result.snapshot.val()?.phase });
  if (!result.committed) throw new Error("The room could not return to the lobby.");
}

export async function endRoom(db: Database, code: string, playerId: string) {
  logEvent("room.end.request", { code, playerId: shortId(playerId) });
  const roomRef = ref(db, `rooms/${code}`);
  const snapshot = await get(roomRef);
  if (snapshot.val()?.hostId !== playerId) throw new Error("Only the host can end the room.");
  await remove(roomRef);
  logEvent("room.end.complete", { code });
}

const nextRemainingPlayer = (order: string[], leavingId: string, remaining: string[]) => {
  const leavingIndex = Math.max(0, order.indexOf(leavingId));
  for (let offset = 1; offset <= order.length; offset += 1) {
    const candidate = order[(leavingIndex + offset) % order.length];
    if (remaining.includes(candidate)) return candidate;
  }
  return remaining[0];
};

const restoreSubmittedCards = (room: Room) => {
  Object.entries(room.submissions ?? {}).forEach(([id, words]) => {
    if (room.players[id] && room.playerOrder.includes(id)) room.players[id].hand = [...(room.players[id].hand ?? []), ...words];
  });
};

const removePlayer = (room: Room, playerId: string): Room | null => {
  room.players ??= {};
  room.playerOrder ??= Object.keys(room.players);
  room.submissions ??= {};
  room.ranking ??= [];
  room.readyPlayers ??= {};
  room.reshuffledPlayers ??= {};
  room.deck ??= [];
  room.discard ??= [];
  if (!room.players[playerId]) return room;
  const leavingName = room.players[playerId].name;
  const oldOrder = [...room.playerOrder];
  const wasHost = room.hostId === playerId;
  const wasRanker = room.rankerId === playerId;
  room.playerOrder = room.playerOrder.filter((id) => id !== playerId);
  if (room.presence) delete room.presence[playerId];
  if (!room.playerOrder.length) return null;
  room.notice = { id: `${Date.now()}-${playerId}`, message: `${leavingName} has left the game.`, at: Date.now() };
  if (wasHost) room.hostId = nextRemainingPlayer(oldOrder, playerId, room.playerOrder);
  delete room.readyPlayers[playerId];
  delete room.reshuffledPlayers[playerId];

  if (room.phase === "reveal" && room.revealedCount >= room.ranking.length) {
    if (wasRanker) delete room.players[playerId];
    if (room.playerOrder.every((id) => room.readyPlayers[id])) beginScoreAnimation(room);
    return room;
  }

  if (room.phase === "lobby" || room.phase === "intermission" || room.phase === "finished") {
    delete room.players[playerId];
    return room;
  }

  if (room.playerOrder.length < 2) {
    delete room.players[playerId];
    room.phase = "finished";
    room.rankerId = room.playerOrder[0];
    return room;
  }

  if (wasRanker && (room.phase === "submitting" || room.phase === "ranking" || room.phase === "reveal")) {
    if (room.phase === "reveal") {
      for (let index = 0; index < room.revealedCount; index += 1) {
        const card = room.ranking[room.ranking.length - index - 1];
        if (room.players[card.playerId]) room.players[card.playerId].score = Math.max(0, room.players[card.playerId].score - (index + 1));
      }
    }
    restoreSubmittedCards(room);
    delete room.players[playerId];
    room.rankerId = nextRemainingPlayer(oldOrder, playerId, room.playerOrder);
    dealForRound(room, room.rankerId);
    return room;
  }

  if (room.phase === "submitting") {
    delete room.submissions[playerId];
    delete room.players[playerId];
    const submitters = room.playerOrder.filter((id) => id !== room.rankerId);
    if (submitters.every((id) => room.players[id].submitted)) {
      room.ranking = shuffle(submitters.flatMap((id) => (room.submissions[id] ?? []).map((word, index) => ({ id: `${id}-${index}-${word}`, word, playerId: id }))));
      room.phase = "ranking";
    }
  }
  return room;
};

export async function leaveRoom(db: Database, code: string, playerId: string) {
  logEvent("room.leave.request", { code, playerId: shortId(playerId) });
  const roomRef = ref(db, `rooms/${code}`);
  const result = await runTransaction(roomRef, (room: Room | null) => {
    if (!room) return room;
    const updated = removePlayer(room, playerId);
    return updated ? touch(updated) : null;
  }, { applyLocally: false });
  logEvent("room.leave.result", { code, playerId: shortId(playerId), committed: result.committed });
}

export async function registerPresence(db: Database, code: string, playerId: string, connectionId: string) {
  const presenceRef = ref(db, `rooms/${code}/presence/${playerId}/${connectionId}`);
  await onDisconnect(presenceRef).remove();
  await set(presenceRef, true);
  logEvent("presence.connected", { code, playerId: shortId(playerId), connectionId: shortId(connectionId) });
  return async () => {
    await remove(presenceRef);
    logEvent("presence.disconnected", { code, playerId: shortId(playerId), connectionId: shortId(connectionId) });
  };
}
