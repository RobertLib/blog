"use client";

import { signOut } from "next-auth/react";
import Button from "./button";

export default function Navbar() {
  return (
    <nav className="flex justify-end border-b p-2">
      <Button
        onClick={() => {
          signOut();
        }}
        size="sm"
        variant="default"
      >
        Logout
      </Button>
    </nav>
  );
}
