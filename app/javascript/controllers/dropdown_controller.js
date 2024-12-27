import { Controller } from "@hotwired/stimulus";

export default class extends Controller {
  static targets = ["menu"];

  connect() {
    this.menuTarget.classList.add("hidden");
  }

  toggle() {
    this.menuTarget.classList.toggle("hidden");
  }
}
