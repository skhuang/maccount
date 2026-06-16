// Worker entry point — router to be implemented in a later task
export default {
  async fetch(_request: Request, _env: unknown): Promise<Response> {
    return new Response("maccount-api", { status: 200 });
  },
};
