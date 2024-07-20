"use server";

import { getDictionary } from "@/dictionaries";
import { redirect } from "next/navigation";
import { z } from "zod";
import bcrypt from "bcrypt";
import prisma from "@/db";

const schema = (dict: Awaited<ReturnType<typeof getDictionary>>) =>
  z
    .object({
      password: z.string().min(8),
      confirmPassword: z.string().min(8),
      token: z.string(),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: dict.errors.passwordsDontMatch,
      path: ["confirmPassword"],
    });

export async function resetPassword(prevState: any, formData: FormData) {
  const dict = await getDictionary();

  const validatedFields = schema(dict).safeParse(Object.fromEntries(formData));

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
    };
  }

  const { password, token } = validatedFields.data;

  try {
    const resetPasswordToken = await prisma.resetPasswordToken.findUnique({
      where: { token },
    });

    if (
      !resetPasswordToken ||
      Date.now() > resetPasswordToken.expires.getTime()
    ) {
      return { errorMessage: dict.errors.invalidToken };
    }

    const hash = await bcrypt.hash(password, 12);

    await prisma.user.update({
      data: { password: hash },
      where: { id: resetPasswordToken.userId },
    });

    await prisma.resetPasswordToken.delete({
      where: { userId: resetPasswordToken.userId },
    });
  } catch (error) {
    console.error(error);

    return { errorMessage: dict.errors.somethingWentWrong };
  }

  return redirect("/login");
}
