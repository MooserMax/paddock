"use client";

import NavDropdown from "./NavDropdown";
import { DOCS_ROUTES } from "@/lib/nav";

// The Docs dropdown groups Odds, Methodology, and API. It is the rightmost group, so its
// menu is right-aligned. All behavior (keyboard, Escape, outside-click, aria) lives in the
// shared NavDropdown so every group is identical.
export default function DocsDropdown() {
  return <NavDropdown label="Docs" routes={DOCS_ROUTES} align="right" />;
}
