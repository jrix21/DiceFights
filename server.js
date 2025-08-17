// server.js — Dice Fights Multiplayer Server for Render
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

function sideFor(room) {
  if (room.players.find(p => p.side === "p1") == null) return "p1";
  if (room.players.find(p => p.side === "p2") == null) return "p2";
  return null;
}

io.on("connection", (socket) => {
  let currentRoom = null;

  socket.on("joinRoom", ({ roomCode, name }) => {
    const code = (roomCode || "lobby").trim().slice(0, 12);
    const room = getOrCreateRoom(code);
    currentRoom = code;
    const side = sideFor(room);

    room.players.push({ id: socket.id, side, name: name || "" });
    socket.join(code);
    socket.emit("joined", { playerId: socket.id, side, state: room.state, code });
    io.to(code).emit("presence", {
      players: room.players.map(p => ({ side: p.side, name: p.name })),
    });
  });

  socket.on("newMatch", ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    room.state = makeEmptyState();
    room.seed = (Math.random() + Date.now()).toString(36);
    io.to(roomCode).emit("stateReset", room.state);
  });

  socket.on("rollRequested", ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
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
    room.players = room.players.filter(p => p.id !== socket.id);
    io.to(currentRoom).emit("presence", {
      players: room.players.map(p => ({ side: p.side, name: p.name })),
    });
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Dice Fights server running on :${PORT}`);
});
