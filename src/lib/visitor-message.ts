/**
 * What a visitor is told when something goes wrong.
 *
 * Before this existed the widget rendered whatever came back verbatim, so
 * somebody trying to find out whether a bricklayer works Saturdays could be
 * shown "index not built - run: npm run ingest -- corpus", or a raw
 * "Failed to fetch". Those are messages for whoever runs the deployment. The
 * person reading them is a customer of a small business, and the widget is
 * wearing that business's name while it says them.
 *
 * The detail is not discarded; the caller logs it to the console, where the
 * developer looking for it will be.
 */
export function visitorMessage(detail: string, status?: number): string {
  if (status === 429) {
    return "That is a lot of questions at once. Give it a moment and ask again.";
  }
  return "Something went wrong answering that. Try again in a moment, or get in touch with us directly.";
}
