"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { CircleHelp, Crown, GripVertical, Minus, Plus, RotateCcw, Shuffle, Sparkles, Trophy, Users, X } from "lucide-react";
import { get, ref } from "firebase/database";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { logError, logEvent, shortId } from "@/lib/debug";
import { db, firebaseReady } from "@/lib/firebase";
import { beginNextGame, createRoom, endRoom, finishReadyRound, joinRoom, leaveRoom, listenToRoom, markReady, newGame, Player, RankedCard, registerPresence, reshuffleHand, revealNext, Room, setExpansions, setTotalGames, startGame, submitCards, submitRanking } from "@/lib/game";
import { EXPANSIONS } from "@/lib/expansions";

type EntryMode = "create" | "join";
const makeRoomCode = () => Array.from({ length: 5 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
const SESSION_KEY = "spot-on-session";

async function copyRoomInvite(room: Room) {
  const url = "https://spot-online.web.app/";
  const plain = `If you're receiving this message, you have nothing better to do but sit and play a game of Spot On! with your friends. You can find them chillin' over here: ${url}\nTell 'em the secret password: *${room.code}*`;
  const html = `If you're receiving this message, you have nothing better to do but sit and play a game of Spot On! with your friends. You can find them over <a href="${url}">here</a><br>. Tell 'em the secret password: <strong>${room.code}</strong>`;
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
    await navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([plain], { type: "text/plain" }), "text/html": new Blob([html], { type: "text/html" }) })]);
  } else await navigator.clipboard.writeText(plain);
}

function Logo({ small = false }: { small?: boolean }) {
  return <div className={`logo ${small ? "logo-small" : ""}`} aria-label="Spot On!"><span>Spot On!</span></div>;
}

function Ambient() {
  return <div className="ambient" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>;
}

function PlayerAvatar({ player, colorIndex = 0, className = "" }: { player: Player; colorIndex?: number; className?: string }) {
  const avatarInitials = player.initials || player.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 3).toUpperCase();
  return <span className={`avatar avatar-color-${Math.abs(colorIndex) % 6} ${className}`}>{avatarInitials}</span>;
}

function SpotlightName({ name }: { name: string }) {
  const viewportRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [distance, setDistance] = useState(0);
  useLayoutEffect(() => {
    const measure = () => setDistance(Math.max(0, (textRef.current?.scrollWidth ?? 0) - (viewportRef.current?.clientWidth ?? 0)));
    measure();
    const frame = window.requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    if (viewportRef.current) observer.observe(viewportRef.current);
    if (textRef.current) observer.observe(textRef.current);
    document.fonts?.ready.then(measure);
    return () => { window.cancelAnimationFrame(frame); observer.disconnect(); };
  }, [name]);
  return <span ref={viewportRef} className="spotlight-name-marquee"><span ref={textRef} className={distance > 0 ? "spotlight-name-text scrolling" : "spotlight-name-text"} style={{ "--spotlight-scroll-distance": `${distance}px` } as React.CSSProperties}>{name} is in the spotlight</span></span>;
}

function Entry({ onEnter }: { onEnter: (room: Room, playerId: string) => void }) {
  const [mode, setMode] = useState<EntryMode>("join");
  const [name, setName] = useState("");
  const [initials, setInitials] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setName((localStorage.getItem("spot-on-name") ?? "").slice(0, 15));
      setInitials((localStorage.getItem("spot-on-initials") ?? "").slice(0, 3).toUpperCase().replace(/[^A-Z]/g, ""));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function go() {
    setError("");
    if (!name.trim() || !initials.trim()) return setError("Forgetting something?");
    if (!firebaseReady || !db) return setError("Add your Firebase details to .env first. The setup guide is in README.md.");
    setBusy(true);
    const playerId = localStorage.getItem("spot-on-player-id") ?? crypto.randomUUID();
    localStorage.setItem("spot-on-player-id", playerId);
    localStorage.setItem("spot-on-name", name.trim());
    localStorage.setItem("spot-on-initials", initials);
    try {
      const targetCode = mode === "create" ? makeRoomCode() : code.trim().toUpperCase();
      logEvent("entry.submit", { mode, code: targetCode, playerId: shortId(playerId), name: name.trim(), initials });
      if (mode === "join" && targetCode.length !== 5) throw new Error("Room codes have five characters.");
      if (mode === "create") await createRoom(db, targetCode, playerId, name, initials);
      else await joinRoom(db, targetCode, playerId, name, initials);
      const snapshot = await get(ref(db, `rooms/${targetCode}`));
      logEvent("entry.room_loaded", { mode, code: targetCode, exists: snapshot.exists() });
      onEnter(snapshot.val(), playerId);
    } catch (caught) {
      logError("entry.failed", caught, { mode, code: code.trim().toUpperCase() || null });
      setError(caught instanceof Error ? caught.message : "Something went sideways. Try again.");
    } finally { setBusy(false); }
  }

  return <main className="entry-shell"><Ambient /><section className="entry-card pop-in"><div className="logo-wrap"><Logo /><p>The guessing game where you&apos;ll even second-guess yourself</p></div><div className="mode-switch" role="tablist" aria-label="Room action"><button className={mode === "create" ? "active" : ""} onClick={() => { setMode("create"); setError(""); }}>Create a room</button><button className={mode === "join" ? "active" : ""} onClick={() => { setMode("join"); setError(""); }}>Join a room</button></div><div className="entry-fields identity-fields"><label>Your full name<input value={name} maxLength={15} autoComplete="name" placeholder="John Spot" onChange={(event) => setName(event.target.value.slice(0, 15))} /></label><label>Your initials<input className="initials-input" value={initials} maxLength={3} autoComplete="off" autoCapitalize="characters" placeholder="JS" onChange={(event) => setInitials(event.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3))} /></label>{mode === "join" && <label className="slide-down room-code-field">Room code<input className="code-input" value={code} maxLength={5} autoCapitalize="characters" placeholder="XXXXX" onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} /></label>}</div>{error && <p className="form-error" role="alert">{error}</p>}<Button className="big-button" size="lg" onClick={go} disabled={busy}>{busy ? "One tiny moment…" : mode === "create" ? "Host" : "Enter"}</Button>{mode === "join" && <p className="button-caption">(I barely know her)</p>}<p className="entry-note"><Users /> 3–6 players · no account needed</p></section></main>;
}

function Scoreboard({ room, open, onOpenChange }: { room: Room; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const ordered = [...room.playerOrder].sort((a, b) => room.players[b].score - room.players[a].score);
  return <Dialog open={open} onOpenChange={onOpenChange}>{open === undefined && <DialogTrigger asChild><Button className="score-trigger" variant="outline"><Trophy /><span>Scores</span></Button></DialogTrigger>}<DialogContent className="score-dialog" aria-describedby={undefined}><DialogHeader><DialogTitle>Scoreboard</DialogTitle></DialogHeader><ol className="score-list">{ordered.map((id, index) => <li key={id}><span className="score-rank">{index + 1}</span><PlayerAvatar player={room.players[id]} colorIndex={room.playerOrder.indexOf(id)} /><strong>{room.players[id].name}</strong><b>{room.players[id].score}</b></li>)}</ol></DialogContent></Dialog>;
}

function Lobby({ room, playerId, onExit, action }: { room: Room; playerId: string; onExit: () => void; action: (fn: () => Promise<void>) => void }) {
  const isHost = room.hostId === playerId;
  const [expansionOpen, setExpansionOpen] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const selectedExpansionIds = room.expansionIds ?? [];
  const totalGames = room.totalGames ?? 3;

  const copyInvite = async () => {
    try {
      await copyRoomInvite(room);
      setInviteCopied(true);
      window.setTimeout(() => setInviteCopied(false), 1800);
      logEvent("lobby.invite_copied", { code: room.code });
    } catch (error) {
      logError("lobby.invite_copy_failed", error, { code: room.code });
    }
  };

  return <main className="lobby-shell"><Ambient /><header className="topbar"><Logo small /><button className="leave-link" onClick={() => action(async () => { if (db) await leaveRoom(db, room.code, playerId); onExit(); })}><X /> Leave</button></header><section className="lobby-card pop-in"><span className="eyebrow">Sit back and wait</span><h1>Ask your friends to hurry up already</h1><div className="invite-tools"><button className="room-code" onClick={copyInvite} aria-label={`Copy invitation for room ${room.code}`}><span>{room.code}</span><small>{inviteCopied ? "invite copied" : "tap to copy invite"}</small></button></div><div className="lobby-options"><div className="game-count"><span>Games</span><div>{isHost && totalGames > 1 && <button aria-label="One fewer game" onClick={() => action(() => setTotalGames(db!, room.code, playerId, totalGames - 1))}><Minus /></button>}<strong>{totalGames}</strong>{isHost && totalGames < 5 && <button aria-label="One more game" onClick={() => action(() => setTotalGames(db!, room.code, playerId, totalGames + 1))}><Plus /></button>}</div></div><button className="expansion-picker" onClick={() => setExpansionOpen(true)}><span>Expansions</span><strong>{selectedExpansionIds.length} expansion{selectedExpansionIds.length === 1 ? "" : "s"} selected</strong></button></div><div className="player-grid">{room.playerOrder.map((id, index) => <div className="player-chip bounce-in" style={{ animationDelay: `${index * 70}ms` }} key={id}><PlayerAvatar player={room.players[id]} colorIndex={index} /><div><strong>{room.players[id].name}</strong><small>{id === room.hostId ? "Host" : "Ready to play"}</small></div>{id === room.hostId && <Crown />}</div>)}{Array.from({ length: 6 - room.playerOrder.length }).map((_, index) => <div className="player-chip empty" key={index}><span className="avatar">+</span><div><strong>This seat&apos;s not taken</strong><small>But it might be very soon</small></div></div>)}</div>{isHost ? <Button className="big-button" size="lg" disabled={room.playerOrder.length < 3} onClick={() => action(() => startGame(db!, room.code, playerId))}>Start the game</Button> : <div className="waiting-pill"><i /> Waiting for the host to start…</div>}{isHost && room.playerOrder.length < 3 && <p className="helper">You need at least {3 - room.playerOrder.length} more player{3 - room.playerOrder.length === 1 ? "" : "s"}.</p>}</section><Dialog open={expansionOpen} onOpenChange={setExpansionOpen}><DialogContent className="expansion-dialog" aria-describedby={undefined}><DialogHeader><DialogTitle>Choose expansions</DialogTitle></DialogHeader><div className="expansion-list">{EXPANSIONS.map((option) => { const selected = selectedExpansionIds.includes(option.id); return <button key={option.id} type="button" aria-pressed={selected} className={`expansion-option expansion-${option.theme} ${selected ? "selected" : ""} ${!option.available ? "coming-soon" : ""}`} disabled={!isHost || !option.available} onClick={() => action(() => setExpansions(db!, room.code, playerId, selected ? selectedExpansionIds.filter((id) => id !== option.id) : [...selectedExpansionIds, option.id]))}><span className="expansion-art" aria-hidden="true"><Image src={option.image} alt="" width={56} height={56} /></span><strong>{option.name}</strong>{!option.available && <span className="expansion-state">Coming soon</span>}</button>; })}</div></DialogContent></Dialog></main>;
}

function GameHeader({ room, playerId, onExit, action }: { room: Room; playerId: string; onExit: () => void; action: (fn: () => Promise<void>) => void }) {
  const ranker = room.rankerId ? room.players[room.rankerId] : null;
  return <header className="game-header"><Logo small /><div className="round-label"><span>Game {room.gameNumber} ({Math.min(room.roundIndex + 1, room.playerOrder.length)}/{room.playerOrder.length})</span>{ranker && <strong className="spotlight-line"><PlayerAvatar player={ranker} colorIndex={room.playerOrder.indexOf(room.rankerId!)} className="mini-avatar" /><SpotlightName name={ranker.name} /></strong>}</div><div className="game-header-actions"><Scoreboard room={room} /><HowToPlay room={room} playerId={playerId} onExit={onExit} action={action} /></div></header>;
}

function SubmitScreen({ room, playerId, action }: { room: Room; playerId: string; action: (fn: () => Promise<void>) => void }) {
  const me = room.players[playerId];
  const isRanker = room.rankerId === playerId;
  const required = room.playerOrder.length <= 4 ? 2 : 1;
  const [selected, setSelected] = useState<string[]>([]);
  const [reshuffling, setReshuffling] = useState(false);
  if (isRanker) {
    const others = room.playerOrder.filter((id) => id !== playerId);
    const done = others.filter((id) => room.players[id].submitted).length;
    return <section className="play-panel waiting-screen spotlight-waiting stage-in"><div className="spotlight-beam" aria-hidden="true" /><div className="waiting-orbit"><PlayerAvatar player={me} colorIndex={room.playerOrder.indexOf(playerId)} className="hero-avatar" /><i /><i /><i /></div><span className="eyebrow">You’re in the spotlight</span><h1>Waiting for brilliant guesses…</h1><p>{done}/{others.length} players have locked in</p><div className="status-list">{others.map((id) => <div key={id} className={room.players[id].submitted ? "done" : "pending"}><PlayerAvatar player={room.players[id]} colorIndex={room.playerOrder.indexOf(id)} /><strong>{room.players[id].name}</strong><em>{room.players[id].submitted ? "Submitted" : "Choosing…"}</em></div>)}</div></section>;
  }
  if (me.submitted) return <section className="play-panel waiting-screen stage-in"><div className="sealed-card"><Sparkles /><span>Locked in!</span></div><h1>You&apos;re all set!</h1><p>Now act nonchalant while everyone else chooses.</p></section>;
  const toggle = (word: string) => setSelected((current) => current.includes(word) ? current.filter((item) => item !== word) : current.length < required ? [...current, word] : required === 1 ? [word] : current);
  const rankerId = room.rankerId!;
  const reshuffled = Boolean(room.reshuffledPlayers?.[playerId]);
  const reshuffle = () => {
    if (reshuffled || reshuffling) return;
    setSelected([]);
    setReshuffling(true);
    window.setTimeout(() => action(async () => {
      try { await reshuffleHand(db!, room.code, playerId); }
      finally { setReshuffling(false); }
    }), 480);
  };
  return <section className="play-panel choose-screen stage-in"><div className="instruction"><h1>What would {room.players[rankerId].name} like best?</h1><p>Choose {required === 2 ? "two cards" : "one card"} and trust your gut.</p></div><div className={`hand ${reshuffling ? "reshuffling" : ""}`}>{me.hand.map((word, index) => <button key={word} disabled={reshuffling} className={`word-card deal-in ${selected.includes(word) ? "selected" : ""}`} style={{ animationDelay: reshuffling ? `${index * 55}ms` : `${index * 110}ms` }} onClick={() => toggle(word)}><span>{word}</span><i>{selected.includes(word) ? selected.indexOf(word) + 1 : "?"}</i></button>)}</div><Button className="confirm-button" size="lg" disabled={reshuffling || selected.length !== required} onClick={() => action(() => submitCards(db!, room.code, playerId, selected))}>Seal my choice{required > 1 ? "s" : ""}</Button>{!reshuffled && !reshuffling && <div className="reshuffle-prompt"><button disabled={room.deck.length < 4} onClick={reshuffle}><Shuffle />Shuffle</button><small>(Once per round)</small></div>}</section>;
}

function RankScreen({ room, playerId, action }: { room: Room; playerId: string; action: (fn: () => Promise<void>) => void }) {
  const isRanker = room.rankerId === playerId;
  const [ranking, setRanking] = useState<RankedCard[]>(room.ranking);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragIndex = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previousPositions = useRef<Map<string, DOMRect> | null>(null);
  useLayoutEffect(() => {
    if (!previousPositions.current || !listRef.current) return;
    listRef.current.querySelectorAll<HTMLElement>("[data-card-id]").forEach((element) => {
      if (element.dataset.cardId === draggingId) return;
      const before = previousPositions.current?.get(element.dataset.cardId ?? "");
      if (!before) return;
      const after = element.getBoundingClientRect();
      const delta = before.top - after.top;
      if (delta) element.animate([{ transform: `translateY(${delta}px)` }, { transform: "translateY(0)" }], { duration: 260, easing: "cubic-bezier(.2,.8,.2,1)" });
    });
    previousPositions.current = null;
  }, [ranking, draggingId]);
  if (!isRanker) return <section className="play-panel waiting-screen stage-in"><div className="ranking-loader"><i /><i /><i /><i /></div><h1>{room.players[room.rankerId!].name} is making their final call</h1><p>Putting their favourites in order. No pressure.</p></section>;
  const move = (from: number, to: number) => {
    previousPositions.current = new Map(Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-card-id]") ?? []).map((element) => [element.dataset.cardId ?? "", element.getBoundingClientRect()]));
    setRanking((current) => { if (from === to) return current; const copy = [...current]; const [item] = copy.splice(from, 1); copy.splice(to, 0, item); return copy; });
  };
  const stopDragging = () => { dragIndex.current = null; setDraggingId(null); };
  return <section className="play-panel rank-screen stage-in"><div className="instruction"><h1>Rank your favourites</h1></div><div ref={listRef} className="rank-list" onPointerMove={(event) => { if (dragIndex.current === null) return; const element = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-rank]"); if (!element) return; const to = Number(element.dataset.rank); const from = dragIndex.current; if (to !== from) { move(from, to); dragIndex.current = to; } }} onPointerUp={stopDragging} onPointerCancel={stopDragging}>{ranking.map((card, index) => <div className={`rank-item ${draggingId === card.id ? "dragging" : ""}`} data-rank={index} data-card-id={card.id} key={card.id}><span className="rank-number">{index + 1}</span><strong>{card.word}</strong><button className="drag-handle" aria-label={`Drag ${card.word}`} onPointerDown={(event) => { dragIndex.current = index; setDraggingId(card.id); event.currentTarget.setPointerCapture(event.pointerId); }} onLostPointerCapture={stopDragging}><GripVertical /></button></div>)}</div><Button className="confirm-button" size="lg" onClick={() => action(() => submitRanking(db!, room.code, playerId, ranking))}>That’s my final answer</Button></section>;
}

function HowToPlay({ room, playerId, onExit, action }: { room: Room; playerId: string; onExit: () => void; action: (fn: () => Promise<void>) => void }) {
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [hearts, setHearts] = useState<Array<{ id: string; x: number; y: number; drift: number; scale: number }>>([]);
  const launchHeart = (event: React.MouseEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const heart = { id: crypto.randomUUID(), x: bounds.left + Math.random() * bounds.width, y: bounds.top + Math.random() * bounds.height, drift: (Math.random() - .5) * 180, scale: .75 + Math.random() * .85 };
    setHearts((current) => [...current, heart]);
    window.setTimeout(() => setHearts((current) => current.filter((item) => item.id !== heart.id)), 1900);
  };
  const copyRulesInvite = async () => {
    try {
      await copyRoomInvite(room);
      setInviteCopied(true);
      window.setTimeout(() => setInviteCopied(false), 1800);
      logEvent("rules.invite_copied", { code: room.code });
    } catch (error) {
      logError("rules.invite_copy_failed", error, { code: room.code });
    }
  };
  return <><Dialog><DialogTrigger asChild><button className="help-trigger" aria-label="How to play"><CircleHelp /></button></DialogTrigger><DialogContent className="rules-dialog"><DialogHeader><DialogTitle>How to Play</DialogTitle><DialogDescription>It&apos;s quite simple, really.</DialogDescription></DialogHeader><div className="rules-room"><button className="rules-room-invite" onClick={copyRulesInvite} aria-label={`Copy invitation for room ${room.code}`}><strong>{room.code}</strong><span>{inviteCopied ? "Invite copied" : "Tap to copy invite"}</span></button><button className="leave-room-button" onClick={() => setConfirmingLeave(true)}>Leave room</button></div><div className="rule-cards"><article><div className="rule-visual pick-visual"><i /><i /><i /></div><p>Choose the cards you think the player in the spotlight would like best.</p></article><article><div className="rule-visual rank-visual"><i /><i /><i /></div><p>The player in the spotlight will rank them for everyone to see.</p></article><article><div className="rule-visual pass-visual"><i>A</i><i>B</i><i>C</i></div><p>Points are awarded and you pass your remaining cards to the left.</p></article><article><div className="rule-visual finish-visual"><Trophy /></div><p>Play moves on until the game ends and someone wins.</p></article></div><button className="rules-credit" onClick={launchHeart}>Made with <span>❤︎</span> by Arnaav</button>{typeof document !== "undefined" && createPortal(hearts.map((heart) => <span key={heart.id} className="floating-heart" style={{ left: heart.x, top: heart.y, "--heart-drift": `${heart.drift}px`, "--heart-scale": heart.scale } as React.CSSProperties}>❤︎</span>), document.body)}</DialogContent></Dialog><Dialog open={confirmingLeave} onOpenChange={setConfirmingLeave}><DialogContent className="confirm-leave-dialog"><DialogHeader><DialogTitle>Leave this room?</DialogTitle><DialogDescription>You won&apos;t be able to join again, so think this through!</DialogDescription></DialogHeader><div className="confirm-leave-actions"><Button variant="outline" onClick={() => setConfirmingLeave(false)}>Stay</Button><Button className="leave-confirm" onClick={() => action(async () => { await leaveRoom(db!, room.code, playerId); onExit(); })}>Leave room</Button></div></DialogContent></Dialog></>;
}

function ScoreAnimation({ room }: { room: Room }) {
  const gains = room.ranking.reduce<Record<string, number>>((totals, card, index) => {
    totals[card.playerId] = (totals[card.playerId] ?? 0) + room.ranking.length - index;
    return totals;
  }, {});
  const startingScores = Object.fromEntries(room.playerOrder.map((id) => [id, Math.max(0, room.players[id].score - (gains[id] ?? 0))]));
  const finalScores = Object.fromEntries(room.playerOrder.map((id) => [id, room.players[id].score]));
  const pointQueue = [...room.ranking].reverse().flatMap((card, index) => Array.from({ length: index + 1 }, () => card.playerId));
  const animation = useRef({ finalScores, pointQueue });
  const [open, setOpen] = useState(true);
  const [settled, setSettled] = useState(false);
  const [changedId, setChangedId] = useState<string | null>(null);
  const [displayedScores, setDisplayedScores] = useState<Record<string, number>>(startingScores);
  const listRef = useRef<HTMLOListElement>(null);
  const previousPositions = useRef<Map<string, DOMRect> | null>(null);

  useLayoutEffect(() => {
    if (!previousPositions.current || !listRef.current) return;
    listRef.current.querySelectorAll<HTMLElement>("[data-score-player]").forEach((element) => {
      const before = previousPositions.current?.get(element.dataset.scorePlayer ?? "");
      if (!before) return;
      const after = element.getBoundingClientRect();
      const delta = before.top - after.top;
      if (delta) element.animate([{ transform: `translateY(${delta}px)` }, { transform: "translateY(0)" }], { duration: 420, easing: "cubic-bezier(.2,.9,.2,1)" });
    });
    previousPositions.current = null;
  }, [displayedScores]);

  useEffect(() => {
    const timers: number[] = [];
    const { finalScores: scoresAfterRound, pointQueue: queuedPoints } = animation.current;
    queuedPoints.forEach((id, index) => {
      timers.push(window.setTimeout(() => {
        previousPositions.current = new Map(Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-score-player]") ?? []).map((element) => [element.dataset.scorePlayer ?? "", element.getBoundingClientRect()]));
        setChangedId(id);
        setDisplayedScores((current) => ({ ...current, [id]: (current[id] ?? 0) + 1 }));
      }, 100 + (index * 3700) / Math.max(1, queuedPoints.length - 1)));
    });
    timers.push(window.setTimeout(() => { setDisplayedScores(scoresAfterRound); setChangedId(null); setSettled(true); }, 4000));
    timers.push(window.setTimeout(() => setOpen(false), 6000));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const ordered = [...room.playerOrder].sort((a, b) => (displayedScores[b] ?? 0) - (displayedScores[a] ?? 0) || room.playerOrder.indexOf(a) - room.playerOrder.indexOf(b));
  return <Dialog open={open} onOpenChange={() => undefined}><DialogContent showCloseButton={false} className="score-splash-dialog" onEscapeKeyDown={(event) => event.preventDefault()} onPointerDownOutside={(event) => event.preventDefault()}><DialogHeader><DialogTitle>{settled ? "Scores are in!" : "Adding it all up…"}</DialogTitle><DialogDescription>{settled ? "Here’s how everyone stands." : "Things can change quickly around here."}</DialogDescription></DialogHeader><ol ref={listRef} className="animated-score-list">{ordered.map((id, index) => <li key={id} data-score-player={id} className={changedId === id ? "gaining" : ""}><span className="score-rank">{index + 1}</span><PlayerAvatar player={room.players[id]} colorIndex={room.playerOrder.indexOf(id)} /><strong>{room.players[id].name}</strong><b>{displayedScores[id] ?? 0}</b></li>)}</ol><div className={`score-animation-progress ${settled ? "settled" : ""}`} /></DialogContent></Dialog>;
}

function AnimatedScorePopup({ room, active }: { room: Room; active: boolean }) {
  return active ? <ScoreAnimation room={room} /> : null;
}

function RevealTiles({ room }: { room: Room }) {
  const firstRevealedIndex = room.ranking.length - room.revealedCount;
  return <ol className="reveal-tile-list" aria-live="polite">{room.ranking.map((card, index) => { const revealed = index >= firstRevealedIndex; const winner = index === 0; return <li key={card.id} className={`reveal-tile ${revealed ? "revealed" : "concealed"} ${winner ? "round-winner" : ""}`} aria-hidden={!revealed}><span className="reveal-rank">#{index + 1}</span><strong>{card.word}</strong><PlayerAvatar player={room.players[card.playerId]} colorIndex={room.playerOrder.indexOf(card.playerId)} />{winner && revealed && <Crown className="winner-crown" />}</li>; })}</ol>;
}

function RevealScreen({ room, playerId, action }: { room: Room; playerId: string; action: (fn: () => Promise<void>) => void }) {
  const isRanker = room.rankerId === playerId;
  const finished = room.revealedCount >= room.ranking.length;
  useEffect(() => { if (!isRanker || finished) return; const timer = window.setTimeout(() => { if (db) revealNext(db, room.code); }, room.revealedCount === 0 ? 700 : 1000); return () => window.clearTimeout(timer); }, [isRanker, finished, room.code, room.revealedCount]);
  const readyCount = room.playerOrder.filter((id) => room.readyPlayers?.[id]).length;
  const everyoneReady = finished && readyCount === room.playerOrder.length && Boolean(room.scoreAnimationAt);
  useEffect(() => {
    if (!everyoneReady || !room.scoreAnimationAt) return;
    const timer = window.setTimeout(() => { if (db) finishReadyRound(db, room.code); }, Math.max(0, room.scoreAnimationAt + 6200 - Date.now()));
    return () => window.clearTimeout(timer);
  }, [everyoneReady, room.code, room.scoreAnimationAt]);
  const amReady = Boolean(room.readyPlayers?.[playerId]);
  const isLastRound = room.roundIndex + 1 >= room.playerOrder.length;
  const readyLabel = isLastRound ? (room.gameNumber >= room.totalGames ? "Finish" : "Next game") : "READY";
  return <section className="play-panel reveal-screen stage-in"><h1>The verdict is in!</h1><RevealTiles room={room} />{finished && <div className="reveal-actions"><Button className="confirm-button ready-button" size="lg" disabled={amReady} onClick={() => action(() => markReady(db!, room.code, playerId))}>{readyLabel}</Button><small>{readyCount}/{room.playerOrder.length} ready</small></div>}<AnimatedScorePopup room={room} active={everyoneReady} /></section>;
}

function FinishedScreen({ room, playerId, action, onExit }: { room: Room; playerId: string; action: (fn: () => Promise<void>) => void; onExit: () => void }) {
  const topScore = Math.max(...room.playerOrder.map((id) => room.players[id].score));
  const winners = room.playerOrder.filter((id) => room.players[id].score === topScore);
  const ordered = [...room.playerOrder].sort((a, b) => room.players[b].score - room.players[a].score || room.playerOrder.indexOf(a) - room.playerOrder.indexOf(b));
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const isHost = room.hostId === playerId;
  const winnerNames = winners.map((id) => room.players[id].name).join(" & ");
  return <><section className="play-panel finish-screen stage-in"><div className="confetti" aria-hidden="true">{Array.from({ length: 18 }).map((_, index) => <i key={index} />)}</div><Trophy className="winner-trophy" /><h1>{winnerNames}, take a bow!</h1><p>{topScore} glorious points</p><ol className="reveal-tile-list final-leaderboard">{ordered.map((id, index) => { const winner = room.players[id].score === topScore; return <li key={id} className={`reveal-tile revealed ${winner ? "round-winner" : ""}`}><span className="reveal-rank">#{index + 1}</span><PlayerAvatar player={room.players[id]} colorIndex={room.playerOrder.indexOf(id)} /><strong>{room.players[id].name}</strong><b>{room.players[id].score}</b>{winner && <Crown className="winner-crown" />}</li>; })}</ol>{isHost ? <div className="finish-actions"><Button className="big-button" size="lg" onClick={() => action(() => newGame(db!, room.code, playerId))}><RotateCcw /> Another!</Button><Button variant="outline" size="lg" onClick={() => setConfirmingEnd(true)}>End room</Button><small>Played cards stay in the discard pile. Scores carry over.</small></div> : <div className="waiting-pill"><i /> The host decides what’s next…</div>}</section><Dialog open={confirmingEnd} onOpenChange={setConfirmingEnd}><DialogContent className="confirm-leave-dialog"><DialogHeader><DialogTitle>End this room?</DialogTitle><DialogDescription>This closes the room for everyone and cannot be undone.</DialogDescription></DialogHeader><div className="confirm-leave-actions"><Button variant="outline" onClick={() => setConfirmingEnd(false)}>Keep playing</Button><Button className="leave-confirm" onClick={() => action(async () => { await endRoom(db!, room.code, playerId); onExit(); })}>End room</Button></div></DialogContent></Dialog></>;
}

function IntermissionScreen({ room, playerId }: { room: Room; playerId: string }) {
  const isHost = room.hostId === playerId;
  useEffect(() => {
    if (!isHost || !db) return;
    const activeDb = db;
    const wait = Math.max(0, (room.nextGameAt ?? Date.now()) - Date.now());
    const timer = window.setTimeout(() => beginNextGame(activeDb, room.code, playerId), wait);
    return () => window.clearTimeout(timer);
  }, [isHost, playerId, room.code, room.nextGameAt]);
  return <section className="intermission-screen stage-in"><div className="intermission-cards" aria-hidden="true"><i /><i /><i /></div><h1>Game {room.gameNumber}/{room.totalGames}</h1><p>Remember to have fun!</p><div className="intermission-loader"><i /><i /><i /></div></section>;
}

function Game({ room, playerId, action, onExit }: { room: Room; playerId: string; action: (fn: () => Promise<void>) => void; onExit: () => void }) {
  if (room.phase === "intermission") return <main className="game-shell intermission-shell"><Ambient /><IntermissionScreen room={room} playerId={playerId} /></main>;
  return <main className="game-shell"><Ambient /><GameHeader room={room} playerId={playerId} onExit={onExit} action={action} />{room.phase === "submitting" && <SubmitScreen room={room} playerId={playerId} action={action} />}{room.phase === "ranking" && <RankScreen room={room} playerId={playerId} action={action} />}{room.phase === "reveal" && <RevealScreen room={room} playerId={playerId} action={action} />}{room.phase === "finished" && <FinishedScreen room={room} playerId={playerId} action={action} onExit={onExit} />}</main>;
}

export default function Home() {
  const [room, setRoom] = useState<Room | null>(null);
  const [playerId, setPlayerId] = useState("");
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const lastNoticeId = useRef<string | null>(null);
  useEffect(() => {
    logEvent("app.mounted", { firebaseReady });
    const handleError = (event: ErrorEvent) => logError("app.window_error", event.error ?? event.message);
    const handleRejection = (event: PromiseRejectionEvent) => logError("app.unhandled_rejection", event.reason);
    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);
  useEffect(() => {
    if (!joined || !room?.code || !playerId || !db) return;
    let cancelled = false;
    let disconnect: (() => Promise<void>) | undefined;
    const connectionId = crypto.randomUUID();
    registerPresence(db, room.code, playerId, connectionId).then((cleanup) => {
      if (cancelled) cleanup().catch((caught) => logError("presence.cleanup.failed", caught));
      else disconnect = cleanup;
    }).catch((caught) => logError("presence.register.failed", caught, { code: room.code, playerId: shortId(playerId) }));
    return () => { cancelled = true; disconnect?.().catch((caught) => logError("presence.disconnect.failed", caught)); };
  }, [joined, room?.code, playerId]);
  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      try {
        const stored = localStorage.getItem(SESSION_KEY);
        if (!stored || !db) return;
        const session = JSON.parse(stored) as { code?: string; playerId?: string };
        if (!session.code || !session.playerId) return localStorage.removeItem(SESSION_KEY);
        logEvent("session.restore.request", { code: session.code, playerId: shortId(session.playerId) });
        const snapshot = await get(ref(db, `rooms/${session.code}`));
        const restoredRoom = snapshot.val() as Room | null;
        if (!restoredRoom?.players?.[session.playerId]) {
          localStorage.removeItem(SESSION_KEY);
          logEvent("session.restore.missing", { code: session.code, playerId: shortId(session.playerId) });
          return;
        }
        if (!cancelled) {
          lastNoticeId.current = restoredRoom.notice?.id ?? null;
          setRoom(restoredRoom);
          setPlayerId(session.playerId);
          setJoined(true);
          logEvent("session.restore.complete", { code: session.code, playerId: shortId(session.playerId), phase: restoredRoom.phase });
        }
      } catch (caught) {
        localStorage.removeItem(SESSION_KEY);
        logError("session.restore.failed", caught);
      } finally { if (!cancelled) setRestoring(false); }
    };
    restore();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!joined || !room?.code || !db) return;
    return listenToRoom(db, room.code, (next) => {
      if (!next) {
        localStorage.removeItem(SESSION_KEY);
        setJoined(false);
        setRoom(null);
        setPlayerId("");
        return;
      }
      if (next.notice?.id && next.notice.id !== lastNoticeId.current) {
        setNotice(next.notice.message);
        logEvent("room.notice.received", { code: next.code, noticeId: next.notice.id });
      }
      lastNoticeId.current = next.notice?.id ?? lastNoticeId.current;
      setRoom(next);
    });
  }, [joined, room?.code]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(""), 4000); return () => window.clearTimeout(timer); }, [notice]);
  const action = async (fn: () => Promise<void>) => { if (busy) { logEvent("ui.action_ignored", { reason: "busy" }); return; } setBusy(true); setError(""); try { await fn(); logEvent("ui.action_complete"); } catch (caught) { logError("ui.action_failed", caught); setError(caught instanceof Error ? caught.message : "Something went sideways."); } finally { setBusy(false); } };
  const enter = (next: Room, id: string) => { logEvent("session.enter", { code: next.code, playerId: shortId(id), phase: next.phase }); localStorage.setItem(SESSION_KEY, JSON.stringify({ code: next.code, playerId: id })); lastNoticeId.current = next.notice?.id ?? null; setRoom(next); setPlayerId(id); setJoined(true); setError(""); };
  const exit = () => { logEvent("session.exit", { code: room?.code ?? null, playerId: shortId(playerId) }); localStorage.removeItem(SESSION_KEY); lastNoticeId.current = null; setRoom(null); setJoined(false); setPlayerId(""); };
  if (restoring) return <main className="entry-shell restore-screen"><Logo /><p>Finding your seat…</p></main>;
  if (!room || !joined) return <><Entry onEnter={enter} />{error && <div className="toast-error" role="alert">{error}</div>}</>;
  const alertMessage = error || notice;
  return <><div className={busy ? "busy-overlay show" : "busy-overlay"}><i /></div>{room.phase === "lobby" ? <><Lobby room={room} playerId={playerId} onExit={exit} action={action} /><HowToPlay room={room} playerId={playerId} onExit={exit} action={action} /></> : <Game room={room} playerId={playerId} action={action} onExit={exit} />}{alertMessage && <button className="toast-error" onClick={() => { setError(""); setNotice(""); }} role="alert" aria-label={`Dismiss message: ${alertMessage}`}>{alertMessage}<X /></button>}</>;
}
