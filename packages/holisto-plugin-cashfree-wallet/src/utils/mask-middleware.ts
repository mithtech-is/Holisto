import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { maskSensitiveData } from "./mask-data";

export const maskCustomerResponse = (req: MedusaRequest, res: MedusaResponse, next: () => void) => {
    const originalJson = res.json;
    
    res.json = function(body: any) {
        if (body && body.customer) {
            body.customer = maskSensitiveData(body.customer);
        } else if (body && body.id && body.metadata) {
            // If it's a direct customer object
            body = maskSensitiveData(body);
        }
        return originalJson.call(this, body);
    };
    
    next();
};
