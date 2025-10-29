import z from "zod";

const contactNumber = z
  .string()
  .min(13, "must  be within 13 digits ")
  .max(13, "not a  valid mobile number");

export const signupSchema = z.object({
  name: z.string().max(20, "name is too long"),
  // phone: contactNumber,
  email: z.email(),
  password: z.string().min(6, "too short password"),
});
