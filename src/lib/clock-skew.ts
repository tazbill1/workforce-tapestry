/**
 * Postgres/PostgREST rejects a freshly minted session token with
 * "JWT issued at future" when the auth server clock runs a second or two ahead
 * of the database clock. The condition is transient, so retry briefly rather
 * than failing the request (which blanks the screen).
 */
export async function withClockSkewRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= 3 || !/issued at future/i.test(message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
