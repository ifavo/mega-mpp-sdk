import { charge as charge_ } from "./Charge.js";

export const megaeth: {
  (parameters: megaeth.Parameters): ReturnType<typeof charge_>;
  charge: typeof charge_;
} = Object.assign((parameters: megaeth.Parameters) => charge_(parameters), {
  charge: charge_,
});

export declare namespace megaeth {
  type Parameters = charge_.Parameters;
}
