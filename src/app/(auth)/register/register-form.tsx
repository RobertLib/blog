"use client";

import { Button, Input } from "@/components/ui";
import { createUser } from "./actions";
import { getDictionary } from "@/dictionaries";
import { useActionState, useState } from "react";

export default function RegisterForm({
  dict,
}: Readonly<{
  dict: Awaited<ReturnType<typeof getDictionary>>;
}>) {
  const [data, setData] = useState({
    email: "",
    password: "",
    confirmPassword: "",
  });

  const [state, formAction, pending] = useActionState(createUser, null);

  const handleChange = ({
    target: { name, value },
  }: React.ChangeEvent<HTMLInputElement>) => {
    setData((prev) => ({ ...prev, [name]: value }));
  };

  return (
    <form action={formAction} className="space-y-4">
      {state?.errorMessage && (
        <div className="alert alert-danger">{state.errorMessage}</div>
      )}

      <Input
        autoComplete="email"
        error={state?.errors?.email}
        label={dict.user.email}
        name="email"
        onChange={handleChange}
        required
        type="email"
        value={data.email}
      />

      <Input
        autoComplete="new-password"
        error={state?.errors?.password}
        label={dict.user.password}
        name="password"
        onChange={handleChange}
        required
        type="password"
        value={data.password}
      />

      <Input
        autoComplete="new-password"
        error={state?.errors?.confirmPassword}
        label={dict.user.confirmPassword}
        name="confirmPassword"
        onChange={handleChange}
        required
        type="password"
        value={data.confirmPassword}
      />

      <Button className="!mt-6 w-full" loading={pending} type="submit">
        {dict.registerForm.submit}
      </Button>
    </form>
  );
}
