"use client";

import { SignOutButton } from "@clerk/nextjs";

export default function UnauthorizedSignOutAction() {
  return (
    <SignOutButton redirectUrl="/sign-in">
      <button type="button" className="btn btn-primary">
        יציאה והחלפת משתמש
      </button>
    </SignOutButton>
  );
}
