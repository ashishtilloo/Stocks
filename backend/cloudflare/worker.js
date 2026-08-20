import { onRequest } from "./functions/api/[[path]].js";

export default {
  fetch(request, env, ctx) {
    return onRequest({
      request,
      env,
      ctx,
      waitUntil: ctx.waitUntil.bind(ctx),
      passThroughOnException() {}
    });
  }
};
