// web3.js, Anchor and @thawgate/sdk use Node's global Buffer, which browsers don't have. main.tsx imports this module
// first, so it runs before any of them.
import { Buffer } from "buffer";

const g = globalThis as { Buffer?: typeof Buffer };
g.Buffer ??= Buffer;
