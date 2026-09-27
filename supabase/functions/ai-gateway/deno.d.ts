/**
 * Trackit X — Edge Function ambient declarations.
 *
 * The function runs on Deno and the app runs on Node through Expo, so the two
 * toolchains each supply globals the other does not. This file declares the Deno
 * ones for `tsc`, and nothing else.
 *
 * Deliberately minimal. `Deno.env` and `Deno.serve` are the only Deno APIs this
 * function uses — no `Deno.readFile`, no filesystem, no `Deno.Command` — which
 * is worth stating because a function that can read the local filesystem is a
 * function that can be made to read a secret off disk.
 *
 * `Deno.env.get` is typed as possibly undefined and the code checks for that at
 * every call site. That is not ceremony: the gateway must start and refuse cleanly
 * when `SUPABASE_SERVICE_ROLE_KEY` is absent, rather than concatenating
 * `undefined` into an Authorization header and producing a 401 from the provider
 * that an administrator would read as "my key is wrong".
 */
declare namespace Deno {
  export namespace env {
    function get(name: string): string | undefined;
  }
  export function serve(handler: (request: Request) => Response | Promise<Response>): {
    finished: Promise<void>;
    shutdown(): Promise<void>;
  };
}
