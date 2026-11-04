// Server regions: the first letter of a room code says where the room runs.
// Cloudflare creates a Durable Object near the first request unless a locationHint is given,
// and never moves it afterwards - so a room gets the hint of its server when it is created.
//   S = Server 1, Asia Tenggara   N = Server 2, Asia Timur   U = Server 3, US   E = Server 4, Eropa
// Codes starting with another letter keep the old behaviour (near the player who opened them).
export const REGIONS = { S: "apac-se", N: "apac-ne", U: "enam", E: "weur" };

export function regionHint(code) {
  return REGIONS[String(code).charAt(0).toUpperCase()];
}
