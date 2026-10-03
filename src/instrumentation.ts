export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { warmUpEmbeddings } = await import("./lib/embeddings");
    warmUpEmbeddings();
  }
}
