"use client";

import { useState } from "react";
import Button from "./button";
import cn from "../../utils/cn";
import Image from "next/image";

export default function Input({
  className,
  dim = "md",
  error,
  fullWidth = true,
  label,
  required = false,
  style,
  type = "text",
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> &
  Readonly<{
    dim?: "sm" | "md" | "lg";
    error?: string | string[];
    fullWidth?: boolean;
    label?: string;
  }>) {
  const [typeState, setTypeState] = useState(type);

  return (
    <label className={cn("block", className)} style={style}>
      {label && (
        <span className="mb-2 inline-block font-medium">
          {label}: {required && <span className="text-danger-500">*</span>}
        </span>
      )}
      <span>
        <span className="flex">
          <input
            {...rest}
            className={cn(
              "rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-2",
              dim === "sm" && "px-2 py-1 text-sm",
              dim === "md" && "px-4 py-2 text-base",
              dim === "lg" && "px-6 py-3 text-lg",
              error && "border-danger-500",
              fullWidth && "w-full",
            )}
            required={required}
            type={type === "password" ? typeState : type}
          />
          {type === "password" && (
            <Button
              onClick={() => {
                setTypeState((prev) =>
                  prev === "password" ? "text" : "password",
                );
              }}
              variant="default"
            >
              <Image
                alt="eye"
                height={20}
                src={
                  typeState === "password"
                    ? "/icons/eye.svg"
                    : "/icons/eye-slash.svg"
                }
                width={20}
              />
            </Button>
          )}
        </span>
        {error && (
          <div className="mt-1 animate-fade-in text-sm text-danger-500">
            {Array.isArray(error) ? error.join(", ") : error}
          </div>
        )}
      </span>
    </label>
  );
}
