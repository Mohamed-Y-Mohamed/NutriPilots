import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./ui";

describe("Button", () => {
  it("does not submit the surrounding form by default", async () => {
    // A submit button inside a form reloads the whole app, which is what made
    // the first "add to diary" press look like a page refresh.
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(
      <form onSubmit={onSubmit}>
        <Button onClick={onClick}>Confirm and log</Button>
      </form>,
    );

    const button = screen.getByRole("button", { name: "Confirm and log" });
    expect(button).toHaveAttribute("type", "button");

    await user.click(button);

    expect(onClick).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("still submits when a caller asks for it", async () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const user = userEvent.setup();

    render(
      <form onSubmit={onSubmit}>
        <Button type="submit">Sign in</Button>
      </form>,
    );

    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});
