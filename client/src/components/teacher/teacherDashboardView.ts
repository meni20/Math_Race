import type { TeacherEvent, TeacherPlayerView, TeacherRoomSnapshot } from "./teacherTypes";

export interface TeacherDashboardStats {
  classAccuracy: number | null;
  totalAnswers: number;
  averageResponseTimeMs: number | null;
  liveEventsCount: number;
  totalStudents: number;
  currentLeaderName: string | null;
}

export interface TeacherDashboardViewModel {
  players: TeacherPlayerView[];
  leaderboard: TeacherPlayerView[];
  stats: TeacherDashboardStats;
  events: TeacherEvent[];
}

export function buildTeacherDashboardView(snapshot: TeacherRoomSnapshot, events: TeacherEvent[]): TeacherDashboardViewModel {
  const players = snapshot.players;
  const leaderboard = [...players].sort((left, right) => {
    if (left.rank !== right.rank) {
      return left.rank - right.rank;
    }
    return right.progressPercent - left.progressPercent;
  });

  const totalCorrect = players.reduce((sum, player) => sum + player.correctAnswers, 0);
  const totalWrong = players.reduce((sum, player) => sum + player.wrongAnswers, 0);
  const totalTimeouts = players.reduce((sum, player) => sum + (player.timeoutAnswers ?? 0), 0);
  const totalAnswers = totalCorrect + totalWrong + totalTimeouts;
  const responseTimes = players
    .map((player) => player.averageAnswerTimeMs ?? 0)
    .filter((value) => value > 0);

  return {
    players,
    leaderboard,
    events,
    stats: {
      classAccuracy: totalAnswers > 0 ? Math.round((totalCorrect / totalAnswers) * 100) : null,
      totalAnswers,
      averageResponseTimeMs: responseTimes.length > 0
        ? Math.round(responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length)
        : null,
      liveEventsCount: events.length,
      totalStudents: players.length,
      currentLeaderName: leaderboard[0]?.name ?? null
    }
  };
}
