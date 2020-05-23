import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import { user } from "firebase-functions/lib/providers/auth";
admin.initializeApp();
const db = admin.firestore();
const mAuth = admin.auth();
class Item {
    // this is the items class we will pass to the app.
    public ListingID: string;
    public Title: string;
    public sellerName: string;
    public sellerUID: string;
    public sellerImageURL: string;
    public Likes: number;
    public ListedTime: String;
    public Rating: number;
    public Description: string;
    public TransactionInformation: string;
    public ProcurementInformation: string;
    public Category: string;
    public Stock: number;
    public Images: string[];
    public Performance: number;
    public isAdvert: boolean;
    //false by default
    public userLiked: boolean;
    // mapped to an enum
    public StockStatus: number;
    //constructor will take the raw data from the database and convert it into the object.
    constructor(ListingID: string, Title: string, seller: Seller, Likes: number, ListedTime: FirebaseFirestore.Timestamp, Rating: number, Description: string, TransactionInformation: string, ProcurementInformation: string, Category: string, Stock: number, Image1: string, Image2: string, Image3: string, Image4: string, AdvertisementPoints: number, isDiscounted: boolean, isRestocked: boolean) {
        this.ListingID = ListingID;
        this.Title = Title;
        this.sellerName = seller.Name;
        this.sellerUID = seller.UID;
        this.sellerImageURL = seller.pictureURL;
        this.Likes = Likes;
        this.ListedTime = ListedTime.toDate().toISOString();
        this.Rating = Rating;
        this.Description = Description;
        this.TransactionInformation = TransactionInformation;
        this.ProcurementInformation = ProcurementInformation;
        this.Category = Category;
        this.Stock = Stock;
        this.isAdvert = AdvertisementPoints != 0
        this.userLiked = false;
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
        this.Performance = (Likes / ((new Date()).valueOf() - ListedTime.toDate().valueOf()) * Math.max(AdvertisementPoints, 1));
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
/**
 * Filters the items by the hottest/best performance level
 */
export const getHottestItems = functions.region("asia-east2").https.onRequest(async (data, response) => {
    try {
       let arrayItem = await getAllItems();
        // sort by performance level
        arrayItem = arrayItem.sort(x => x.Performance);
        //if the userID exists in the request body, add their liked items
        if (data.body.userID) {
            arrayItem = await markLikedItems(data.body.userID, arrayItem);
        }
        // send the response after all the final modifications
        response.send(arrayItem);
    } catch (err) {
        // log the error
        console.log(err);
        response.status(500).send(err);
    }
});

/**
 * Simple function that gets all the item categories
 */
export const getCategories = functions.region("asia-east2").https.onRequest(async (data, response) => {
    try {
        const categoriesSnapshot = await db.collection("Categories").get();
        const categories = new Array<string>();
        categoriesSnapshot.forEach((categoryDoc) => {
            //add category name to the list
            console.log(categoryDoc.data().Name);
            categories.push(categoryDoc.data().Name);
        });
        response.send(categories);
    } catch (err) {
        console.log(err);
        response.status(500).send(err);
    }
});

export const getItemByFollowed = functions.region("asia-east2").https.onRequest(async (data, response) => {
    try {
        // get all items so we can filter it later
        let arrayItem = await getAllItems();
        // sort by performance level
        arrayItem = arrayItem.sort(x => x.Performance);
        if (data.body.userID) {
            arrayItem = await markLikedItems(data.body.userID, arrayItem);
        }
        // send the response after all the final modifications
        const promises1 = new Array<Promise<FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>>>();
        const user = await db.collection("users").where("UID", "==", data.body.userID).get();
        user.forEach((user)=>{
            promises1.push(user.ref.collection("Following").get());
        });
        const followerSnapshots = await Promise.all(promises1);
        const returnList = new Array<Item>();
        followerSnapshots.forEach(followerSnapshot=>{
            followerSnapshot.forEach(followerDoc=>{
                const followerData = followerDoc.data();
                //avoid just filtering everything and filter it to a sublist that we will concat to the mainlist
                returnList.push.apply(returnList, arrayItem.filter(x=> x.sellerUID == followerData.UserID));
            })
        })
        response.send(returnList);
    } catch (err) {
        // log the error
        console.log(err);
        response.status(500).send(err);
    }
});
export const getItemBySuggestion = functions.region("asia-east2").https.onRequest(async (data, response) => {
    try{

    }catch(err){
        console.log(err);
        response.status(500).send(err);
    }
});

const markLikedItems = async function (userID: string, Items: Array<Item>) {
    try {
        // there is only one user so limit one
        const userDocs = await db.collection('users').where("UID", "==", userID).limit(1).get();
        let userDoc: FirebaseFirestore.QueryDocumentSnapshot;
        // run a foreach, there is only 1 but this is the only way to get the item...
        userDocs.forEach((doc) => {
            userDoc = doc;
        })
        const likedItems = await userDoc.ref.collection('LikedItems').get();
        likedItems.forEach(likedDoc => {
            const likedItemData = likedDoc.data();
            if (likedItemData.ItemID) {
                // lambda that marks every item with the same listing id as a liked item as liked.
                // the ternary is to avoid marking items already true as false again.
                Items = Items.map(x => { x.userLiked = x.userLiked ? true : x.ListingID == likedItemData.ItemID; return x });
            }
        });
    } catch (err) {
        console.log(err);
    }
    return Items;
}

const getAllItems = async function(): Promise<Array<Item>>{
    try {
        var arrayItem = new Array<Item>();
        let itemSeller: Seller;
        const sellerSnapshot = await db.collection("users").get();
        // this is the list of promises/awaitables for all items
        const promises = new Array<Promise<FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>>>();
        const arrayDoc = new Array<FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>>();
        //convert all the seller snapshots into a list we can process
        sellerSnapshot.forEach(doc=>{
            arrayDoc.push(doc);
        });
        for (let index = 0; index < arrayDoc.length; index++) {
            const sellerDoc = arrayDoc[index];
            const sellerData = sellerDoc.data();
            // check for non null / empty strings
            if (sellerData.Name as string && sellerData.UID as string) {
                const sellerAuth = await mAuth.getUser(sellerData.UID);
                // this is all the seller information we need
                itemSeller = new Seller(sellerAuth.displayName, sellerData.UID, sellerAuth.photoURL); // placeholder profile picture
                const refItem = sellerDoc.ref.collection("Items");
                // push all the promises to a list so we can run all our queries in parallel
                promises.push(refItem.get());
            }
        }
        const itemSnapshots = await Promise.all(promises);
        itemSnapshots.forEach((ItemSnapshot) => {
            ItemSnapshot.forEach((ItemDoc) => {
                // get the data
                const itemData = ItemDoc.data();
                // if title is not null, the rest of the fields are unlikely to be.
                if (itemData.Title as string) {
                    // the rest of the logic to convert from database to model is in the constructor
                    arrayItem.push(new Item(ItemDoc.id, itemData.Title, itemSeller, itemData.Likes, itemData.ListedTime, itemData.Rating, itemData.Description, itemData.TransactionInformation, itemData.ProcurementInformation, itemData.Category, itemData.Stock, itemData.Image1, itemData.Image2, itemData.Image3, itemData.Image4, itemData.AdvertisementPoints, itemData.isDiscounted, itemData.isRestocked));
                }
            });
        });
        // sort by performance level
        return arrayItem;
    } catch (err) {
        // log the error
        console.log(err);
        // handle in try catch of other functions
        throw err;
    }
}

export const helloWorld = functions.region("asia-east2").https.onRequest((request, response) => {
    response.send("Hello from Firebase!");
});
