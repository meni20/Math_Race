import type { TeacherRoomSummary } from "./teacherTypes";

interface TeacherRoomsDrawerProps {
  open: boolean;
  rooms: TeacherRoomSummary[];
  selectedRoomCode?: string;
  loading: boolean;
  onClose: () => void;
  onNewRoom: () => void;
  onOpenRoom: (roomCode: string) => void;
  onDeleteRoom: (roomCode: string) => void;
}

function formatDate(value: string | null) {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function statusTone(status: TeacherRoomSummary["status"]) {
  if (status === "RACING") {
    return "border-emerald-200/25 bg-emerald-400/12 text-emerald-100";
  }
  if (status === "WAITING" || status === "CREATED" || status === "DRAFT") {
    return "border-cyan-100/25 bg-cyan-300/12 text-cyan-100";
  }
  return "border-slate-100/15 bg-white/6 text-slate-200";
}

export function TeacherRoomsDrawer({
  open,
  rooms,
  selectedRoomCode,
  loading,
  onClose,
  onNewRoom,
  onOpenRoom,
  onDeleteRoom
}: TeacherRoomsDrawerProps) {
  const activeRooms = rooms.filter((room) => room.status === "WAITING" || room.status === "CREATED" || room.status === "DRAFT");
  const runningRooms = rooms.filter((room) => room.status === "RACING");
  const previousRooms = rooms.filter((room) => room.status === "FINISHED" || room.status === "CLOSED");

  if (!open) {
    return null;
  }

  const handleNewRoom = () => {
    onNewRoom();
    onClose();
  };

  const handleOpenRoom = (roomCode: string) => {
    onOpenRoom(roomCode);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/72 backdrop-blur-sm">
      <button type="button" aria-label="Close rooms drawer" className="absolute inset-0 cursor-default" onClick={onClose} />
      <aside className="absolute right-0 top-0 z-10 flex h-full w-full max-w-md flex-col border-l border-white/10 bg-slate-950 p-4 shadow-[-20px_0_60px_rgba(0,0,0,0.35)]">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-100/70">Rooms</p>
            <h2 className="text-xl font-black text-white">{loading ? "Refreshing..." : `${rooms.length} saved`}</h2>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={handleNewRoom} className="rounded-full border border-cyan-100/30 bg-cyan-300/12 px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-cyan-50 transition hover:bg-cyan-300/20">
              New Room
            </button>
            <button type="button" onClick={onClose} className="rounded-full border border-white/12 bg-white/6 px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-white transition hover:bg-white/10">
              Close
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pt-4">
          <RoomGroup title="Active Rooms" rooms={activeRooms} selectedRoomCode={selectedRoomCode} onOpenRoom={handleOpenRoom} onDeleteRoom={onDeleteRoom} />
          <RoomGroup title="Running Rooms" rooms={runningRooms} selectedRoomCode={selectedRoomCode} onOpenRoom={handleOpenRoom} onDeleteRoom={onDeleteRoom} />
          <RoomGroup title="Previous Rooms" rooms={previousRooms} selectedRoomCode={selectedRoomCode} onOpenRoom={handleOpenRoom} onDeleteRoom={onDeleteRoom} />
        </div>
      </aside>
    </div>
  );
}

function RoomGroup({
  title,
  rooms,
  selectedRoomCode,
  onOpenRoom,
  onDeleteRoom
}: {
  title: string;
  rooms: TeacherRoomSummary[];
  selectedRoomCode?: string;
  onOpenRoom: (roomCode: string) => void;
  onDeleteRoom: (roomCode: string) => void;
}) {
  return (
    <section className="mb-5">
      <p className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-cyan-100/70">{title}</p>
      <div className="grid gap-2">
        {rooms.length === 0 ? (
          <p className="rounded-lg border border-white/10 bg-white/[0.035] px-3 py-3 text-xs text-slate-400">No rooms</p>
        ) : rooms.map((room) => (
          <RoomRow key={room.id || room.roomCode} room={room} selected={room.roomCode === selectedRoomCode} onOpenRoom={onOpenRoom} onDeleteRoom={onDeleteRoom} />
        ))}
      </div>
    </section>
  );
}

function RoomRow({
  room,
  selected,
  onOpenRoom,
  onDeleteRoom
}: {
  room: TeacherRoomSummary;
  selected: boolean;
  onOpenRoom: (roomCode: string) => void;
  onDeleteRoom: (roomCode: string) => void;
}) {
  return (
    <div className={`rounded-lg border p-3 ${selected ? "border-cyan-100/45 bg-cyan-100/10" : "border-white/10 bg-white/[0.045]"}`}>
      <button type="button" onClick={() => onOpenRoom(room.roomCode)} className="block w-full text-left">
        <span className="block truncate text-sm font-black text-white">{room.raceName}</span>
        <span className="mt-1 flex items-center justify-between gap-2 text-[11px] uppercase tracking-[0.1em] text-cyan-100/75">
          <span>{room.roomCode}</span>
          <span className={`rounded-full border px-2 py-0.5 ${statusTone(room.status)}`}>{room.status}</span>
        </span>
        <span className="mt-1 block text-xs text-slate-300">
          {room.currentPlayers}/{room.maxPlayers} students · {formatDate(room.createdAt)}
        </span>
      </button>
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={() => onDeleteRoom(room.roomCode)} className="flex-1 rounded-md border border-rose-200/25 bg-rose-500/12 px-2 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-rose-100 transition hover:bg-rose-500/20">
          Delete
        </button>
      </div>
    </div>
  );
}
