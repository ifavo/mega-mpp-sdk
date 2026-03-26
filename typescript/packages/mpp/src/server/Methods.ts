import { charge as charge_ } from "./Charge.js";
import { session as session_ } from "./Session.js";

export const megaeth: {
  (parameters?: megaeth.Parameters): ReturnType<typeof charge_>;
  charge: typeof charge_;
  session: typeof session_;
} = Object.assign((parameters?: megaeth.Parameters) => charge_(parameters), {
  charge: charge_,
  session: session_,
});

export declare namespace megaeth {
  type Parameters = charge_.Parameters;
}
