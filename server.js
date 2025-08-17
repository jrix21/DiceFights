// server.js — robust seat assignment, ghost cleanup, name sync
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import seedrandom from "seedrandom";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

function makeEmptyState() {
  return {
    gamePhase: "start",
    playerNames: { p1: "Player 1", p2: "Player 2" },
    turnCount: 0,
    players: {
      p1: { hp: 20, gold: 0, diceCount: 5, atkMult: 1, defMult: 1, goldMult: 1 },
      p2: { hp: 20, gold: 0, diceCount: 5, atkMult: 1, defMult: 1, goldMult: 1 },
    },
  };
}

const rooms = new Map();

function getOrCreateRoom(roomCode) {
  if (!rooms.has(roomCode)) {
    rooms.set(roomCode, {
      seed: (Math.random() + Date.now()).toString(36),
      state: makeEmptyState(),
      players: [],
      lastRollAt: 0,
    });
  }
  return rooms.get(roomCode);
}

function pruneDisconnected(room) {
  room.players = room.players.filter(p => io.sockets.sockets.has(p.id));
}

function sideFor(room) {
  const hasP1 = room.players.some(p => p.side === "p1");
  const hasP2 = room.players.some(p => p.side === "p2");
  if (!hasP1) return "p1";
  if (!hasP2) return "p2";
  return null;
}

function lobbyStatus(room) {
  const hasP1 = room.players.some(p => p.side === "p1");
  const hasP2 = room.players.some(p => p.side === "p2");
  return (hasP1 && hasP2) ? "ready" : "waiting";
}

io.on("connection", (socket) => {
  let currentRoom = null;
  let mySide = null;

  socket.on("joinRoom", ({ roomCode, name }) => {
    const code = (roomCode || "lobby").trim().slice(0, 20);
    const nick = (name || "").trim() || "Player";

    const room = getOrCreateRoom(code);
    currentRoom = code;

    pruneDisconnected(room);

    mySide = sideFor(room);
    room.players.push({ id: socket.id, side: mySide, name: nick });

    if (mySide === "p1" || mySide === "p2") {
      room.state.playerNames[mySide] = nick;
    }

    socket.join(code);
    socket.emit("joined", { playerId: socket.id, side: mySide, state: room.state, code });

    io.to(code).emit("presence", {
      players: room.players.map(p => ({ side: p.side, name: p.name })),
      status: lobbyStatus(room),
      playerNames: room.state.playerNames,
    });
  });

  socket.on("newMatch", ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    pruneDisconnected(room);
    const keepNames = { ...room.state.playerNames };
    room.state = makeEmptyState();
    room.state.playerNames = keepNames;
    room.seed = (Math.random() + Date.now()).toString(36);
    io.to(roomCode).emit("stateReset", room.state);
    io.to(roomCode).emit("presence", {
      players: room.players.map(p => ({ side: p.side, name: p.name })),
      status: lobbyStatus(room),
      playerNames: room.state.playerNames,
    });
  });

  socket.on("rollRequested", ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    pruneDisconnected(room);

    const hasP1 = room.players.some(p => p.side === "p1");
    const hasP2 = room.players.some(p => p.side === "p2");
    if (!(hasP1 && hasP2)) {
      io.to(socket.id).emit("lobbyMessage", { text: "Waiting for opponent…" });
      io.to(roomCode).emit("presence", {
        players: room.players.map(p => ({ side: p.side, name: p.name })),
        status: lobbyStatus(room),
        playerNames: room.state.playerNames,
      });
      return;
    }

    const now = Date.now();
    if (now - room.lastRollAt < 600) return;
    room.lastRollAt = now;

    const rng = seedrandom(`${room.seed}:${room.state.turnCount}`);
    const rollFace = () => {
      const r = Math.floor(rng() * 6);
      if (r < 2) return "sword";
      if (r < 4) return "shield";
      return "gold";
    };
    const faces = (n) => Array.from({ length: n }, rollFace);

    const p1Faces = faces(room.state.players.p1.diceCount);
    const p2Faces = faces(room.state.players.p2.diceCount);
    room.state.turnCount += 1;

    io.to(roomCode).emit("rollFaces", {
      turn: room.state.turnCount,
      p1Faces,
      p2Faces,
    });
  });

  socket.on("disconnect", () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    pruneDisconnected(room);
    room.players = room.players.filter(p => p.id !== socket.id);
    io.to(currentRoom).emit("presence", {
      players: room.players.map(p => ({ side: p.side, name: p.name })),
      status: lobbyStatus(room),
      playerNames: room.state.playerNames,
    });
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Dice Fights server running on :${PORT}`);
});
