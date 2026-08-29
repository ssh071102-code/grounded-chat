import { Chat } from "@/components/Chat";
import { DEFAULT_MODEL, resolveMode } from "@/lib/config";
import type { Metadata } from "next";

/**
 * The widget surface: the same chat, framed on the site it answers for.
 *
 * This is what makes the project installable. Without it the only thing to
 * hand someone is a link to a page hosted elsewhere, which is not something
 * that goes on a WordPress, Squarespace or Webflow site.
 *
 * The chrome is the same as the main page; the difference is that this route
 * is meant to be loaded inside an iframe, and `middleware.ts` decides which
 * origins may do that.
 */
export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  const business = process.env.BUSINESS_NAME;
  return {
    title: business ? `Ask ${business}` : "Grounded answers",
    // The frame is a component of someone else's page, not a page of its own.
    // Indexed separately it competes with that site under its own name.
    robots: { index: false, follow: false },
  };
}

export default function Embed() {
  return (
    <Chat mode={resolveMode()} model={process.env.ANTHROPIC_MODEL || DEFAULT_MODEL} />
  );
}
