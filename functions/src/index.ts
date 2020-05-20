import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
admin.initializeApp();
const db = admin.firestore();
class Item {
    // this is the items class we will pass to the app.
    public Title: string;
    public seller: Seller;
    public Likes: number;
    public ListedTime: Date;
    public Rating: number;
    public Description: string;
    public TranscationInformation: string;
    public ProcurementInformation: string;
    public PaymentType: string;
    public Category: string;
    public Stock: number;
    public Images: string[];
    public Performance: number;
    public isAdvert: boolean;
    // mapped to an enum
    public StockStatus: number;
    constructor(Title: string, seller: Seller, Likes: number, ListedTime: Date, Rating: number, Description: string, TransactionInformation: string, ProcurementInformation: string, PaymentType: string, Category: string, Stock: number, Image1: string, Image2: string, Image3: string, Image4: string, AdvertisementPoints: number, isDiscounted: boolean, isRestocked: boolean) {
        this.Title = Title;
        this.seller = seller;
        this.Likes = Likes;
        this.ListedTime = ListedTime;
        this.Rating = Rating;
        this.Description = Description;
        this.TranscationInformation = TransactionInformation;
        this.ProcurementInformation = ProcurementInformation;
        this.PaymentType = PaymentType;
        this.Category = Category;
        this.Stock = Stock;
        // convert stock status into the enum for the application
        // it is intended for isDiscounted to take priority over the rest as it contributes to the most score in the algorithm
        if (isDiscounted) {
            this.StockStatus = 4;
        } else if (Stock <= 10) {
            // STATUS_RUNNING_OUT
            this.StockStatus = 3;
        } else if (isRestocked) {
            this.StockStatus = 2;
        } else {
            this.StockStatus = 1;
        }
        const images = new Array<string>();
        // if the image urls are null or empty, do not add them to the list.
        if (Image1 as string) {
            images.push(Image1);
        }
        if (Image2 as string) {
            images.push(Image2);
        }
        if (Image3 as string) {
            images.push(Image3);
        }
        if (Image4 as string) {
            images.push(Image4);
        }
        this.Images = images;
        // performance on the list is calculated by number of likes over time multiplied by advertisement points
        this.Performance = (Likes / ((new Date()).valueOf() - ListedTime.valueOf()) * Math.max(AdvertisementPoints, 1));
    }

}

class Seller {
    public Name: string;
    public UID: string;
    public pictureURL: string;

    constructor(name: string, uid: string, pictureurl: string) {
        this.Name = name;
        this.UID = uid;
        this.pictureURL = pictureurl;
    }

}

export const getUserItems = functions.https.onRequest(async (data, response) => {
    try{
    const arrayItem = new Array<Item>();
    let itemSeller: Seller;
    // we do not have a system for user preference, so for now just list all items.
    const sellerSnapshot = await db.collection("users").get();
    // this is the list of promises/awaitables for all items
    const promises = new Array<Promise<FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>>>();
    sellerSnapshot.forEach((sellerDoc) => {
        const sellerData = sellerDoc.data();
        // check for non null / empty strings
        if (sellerData.Name as string && sellerData.UID as string) {
            // this is all the seller information we need
            itemSeller = new Seller(sellerData.Name, sellerData.UID, ""); // placeholder profile picture
            const refItem = sellerDoc.ref.collection("Items");
            // push all the promises to a list so we can run all our queries in parallel
            promises.push(refItem.get());

        }
    });
    // wait for all promises to finish and get a list of snapshots
    const itemSnapshots = await Promise.all(promises);
    itemSnapshots.forEach((ItemSnapshot) => {
        ItemSnapshot.forEach((ItemDoc) => {
            // get the data
            const itemData = ItemDoc.data();
            // if title is not null, the rest of the fields are unlikely to be.
            if (itemData.Title as string) {
                // the rest of the logic to convert from database to model is in the constructor
                arrayItem.push(new Item(itemData.Title, itemSeller, itemData.Likes, itemData.ListedTime, itemData.Rating, itemData.Description, itemData.TransactionInformation, itemData.ProcurementInformation, itemData.PaymentType, itemData.Category, itemData.Stock, itemData.Image1, itemData.Image2, itemData.Image3, itemData.Image4, itemData.AdvertisementPoints, itemData.isDiscounted, itemData.isRestocked));
            }
        });
    });
    // sort by performance level
    arrayItem.sort(x => x.Performance);
    response.send(arrayItem);
}catch (err){
    // log the error
    console.log(err);
    response.status(500).send(err);
}
});
export const helloWorld = functions.https.onRequest((request, response) => {
    response.send("Hello from Firebase!");
});
