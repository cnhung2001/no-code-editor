import { get } from 'svelte/store';
import { BaseCommand } from './base';
import { type Product } from '../products';
import type { State } from '../state';

export class ChangeProductsCommand extends BaseCommand {
    private before: Product[];
    private after: Product[];

    constructor(state: State, newProducts: Product[]) {
        super();
        this.before = get(state.products);
        this.after = newProducts;
    }

    undo(state: State): void {
        state.products.set(this.before);
    }

    redo(state: State): void {
        state.products.set(this.after);
    }

    canMerge(other: BaseCommand): boolean {
        return super.canMerge(other) && other instanceof ChangeProductsCommand &&
            this.after === other.before;
    }

    mergeMeWith(other: this): void {
        this.after = other.after;
    }

    toLangKey(): string {
        return 'commands.change_products';
    }
}
