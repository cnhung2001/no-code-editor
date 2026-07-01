export interface Product {
    __id: string;
    id: string;
    product_id: string;
    variable_type: string;
    type?: string;
    divisor?: string;
    multiplier?: string;
    isIntroductoryOffer?: boolean;
}

export interface JsonProduct {
    id: string;
    product_id: string;
    variable_type: string;
    type?: string;
    divisor?: string;
    multiplier?: string;
    isIntroductoryOffer?: boolean;
}

export function productToJson(product: Product): JsonProduct {
    const json: JsonProduct = {
        id: product.id,
        product_id: product.product_id,
        variable_type: product.variable_type,
    };
    if (product.type) {
        json.type = product.type;
    }
    if (product.divisor) {
        json.divisor = product.divisor;
    }
    if (product.multiplier) {
        json.multiplier = product.multiplier;
    }
    if (product.isIntroductoryOffer !== undefined) {
        json.isIntroductoryOffer = product.isIntroductoryOffer;
    }
    return json;
}
