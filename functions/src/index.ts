import * as admin from "firebase-admin";
import * as functions from "firebase-functions";

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
    public Price: number;
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
    public isUsed: boolean;
    public Location: string;
    constructor(ListingID: string, Title: string, seller: Seller, Likes: number, ListedTime: FirebaseFirestore.Timestamp, Price: number, Rating: number, Description: string, TransactionInformation: string, ProcurementInformation: string, Category: string, Stock: number, Image1: string, Image2: string, Image3: string, Image4: string, AdvertisementPoints: number, isDiscounted: boolean, isRestocked: boolean, isUsed:boolean, Location:string) {
        this.ListingID = ListingID;
        this.Title = Title;
        this.sellerName = seller.Name;
        this.sellerUID = seller.UID;
        this.sellerImageURL = seller.pictureURL;
        this.Likes = Likes;
        this.ListedTime = ListedTime.toDate().toISOString();
        this.Price = Price;
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
        this.Location = Location;
        this.isUsed = isUsed;
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
// cache all the items in the database for faster user access.
let ItemsCache : Array<Item>;
let CategoriesCache : Array<string>;
let updateItemsCache = true;
let updateCategoriesCache = true;
// observe for changes in items, then update cache when necessary
let itemsObserveQuery = function(){ 
    db.collectionGroup("Items").onSnapshot((snapshot)=>{
        console.log("item updated")
        updateItemsCache = true;
        // do not await as onSnapshot is not promise aware
        getAllItems(true);
    }, err=>{
        console.log(err);
    });
}
let categoriesObserveQuery = function(){
    db.collection("Categories").onSnapshot((snapshot)=>{
    console.log("cat updated")
    updateCategoriesCache = true;
    // do not await as onSnapshot is not promise aware
    getAllCategories(true);
}, err=>{
    console.log(err)});
}
/**
 * Get seller items by seller's UID
 */
export const getSellerItems = functions.region("asia-east2").https.onRequest(async (data, response) => {
    try{
        var allItems = await getAllItems();
        // let try catch handle the error if userID is null
        allItems = allItems.filter(x=>x.sellerUID == data.body.userID);
         //mark liked items
         if (data.body.userID) {
            allItems = await markLikedItems(data.body.userID, allItems);
        }
        
        // send all the items
        response.send(allItems);
        
    }catch(err){
        console.log(err);
        response.status(500).send(err);
    }
});
/**
 * Filters the items by the hottest/best performance level
 */
export const getHottestItems = functions.region("asia-east2").https.onRequest(async (data, response) => {
    try {
       let arrayItem = await getAllItems();
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
        // just send the getAllCategories function, which handles caching too.
        response.send(await getAllCategories());
    } catch (err) {
        console.log(err);
        response.status(500).send(err);
    }
});
const getAllCategories = async function(fromObserver: Boolean = false) : Promise<Array<string>>{
    try {
        if(updateCategoriesCache){
        const categoriesSnapshot = await db.collection("Categories").get();
        var categories = new Array<string>();
        categoriesSnapshot.forEach((categoryDoc) => {
            //add category name to the list
            console.log(categoryDoc.data().Name);
            categories.push(categoryDoc.data().Name);
        });
        categories = categories.sort();
        // assign to the cache and return the cache when called
        CategoriesCache = categories;
        // do not update the next time as it has already been updated.
        updateCategoriesCache = false;
        // avoid calling another observer if already from one
        if(!fromObserver){
            // run the observe function so we update categories if there is an update.
            categoriesObserveQuery();
        }
    }
    return CategoriesCache;
    } catch (err) {
        console.log(err);
        return null;
    }
}
/**
 * Simple function that gets all the procurement types
 */
export const getProcurementTypes = functions.region("asia-east2").https.onRequest(async (data, response) => {
    try {
        var procurementTypes = new Array<string>();
        const procurmentSnapshot = await db.collection("ProcurementTypes").get();
        procurmentSnapshot.forEach(procurementDoc=>{
            // add the name of the procurement type for every 
            procurementTypes.push(procurementDoc.data().Name);
        });
        // sort by alphebetical order
        procurementTypes = procurementTypes.sort();
        response.send(procurementTypes);
    } catch (err) {
        console.log(err);
        response.status(500).send(err);
    }
});
/**
 * Simple function that gets all the payment types
 */
export const getPaymentTypes = functions.region("asia-east2").https.onRequest(async (data, response) => {
    try {
        var paymentTypes = new Array<string>();
        const procurmentSnapshot = await db.collection("PaymentTypes").get();
        procurmentSnapshot.forEach(paymentDoc=>{
            // add the name of the payment type for every 
            paymentTypes.push(paymentDoc.data().Name);
        });
        // sort by alphebetical order
        paymentTypes = paymentTypes.sort();
        response.send(paymentTypes);
    } catch (err) {
        console.log(err);
        response.status(500).send(err);
    }
});

/**
 * Get Items from people the user follows
 */
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

/**
 * Get suggested items by the user's ID, right now we are only filtering it by subscribed categories
 */
export const getItemBySuggestion = functions.region("asia-east2").https.onRequest(async (data, response) => {
    try{
        // get all items and filter it afterwards
        var allItems = await getAllItems();
        const userSnapshot = await db.collection('users').where("UID", "==", data.body.userID).limit(1).get();
        let userDoc: FirebaseFirestore.QueryDocumentSnapshot;
        // run a foreach, there is only 1 but this is the only way to get the item...
        userSnapshot.forEach((doc) => {
            userDoc = doc;
        });
        // get the user's subscrobed category
        const subscribedCategoriesSnapshot = await userDoc.ref.collection("SubscribedCategories").get();
        // if there are no results, this will not run, so just return everything for now. we can make this more sophisticated in the future.
        subscribedCategoriesSnapshot.forEach((subDoc)=>{
            const categoryData = subDoc.data();
            allItems = allItems.filter(x=> x.Category == categoryData.CategoryName);
        });
        //mark liked items
        if (data.body.userID) {
            allItems = await markLikedItems(data.body.userID, allItems);
        }
        response.send(allItems);
    }catch(err){
        console.log(err);
        response.status(500).send(err);
    }
});

/**
 * Marks items as liked by the userID
 * @param userID 
 * @param Items 
 */
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

/**
 * gets all the items from firebase/firestore
 */
const getAllItems = async function (fromObserver : Boolean = false): Promise<Array<Item>> {
    try {
        //if the cache is due for an update, get it.
        if (updateItemsCache) {
            var returnArray = new Array<Item>();
            //only get sellers
            const sellerSnapshot = await db.collection("users").where("Type", "==", "Seller").get();
            // this is the list of promises/awaitables for all items
            // we will run the seller function in parallel to speed things up
            const promisesProcessSeller = new Array<Promise<Array<Item>>>();
            const processRefItem = async function (itemSeller: Seller, refItem: FirebaseFirestore.CollectionReference<FirebaseFirestore.DocumentData>): Promise<Array<Item>> {
                var arrayItem = new Array<Item>();
                const itemSnapshot = await refItem.get();
                const promises = new Array<Promise<Item>>();
                itemSnapshot.forEach((ItemDoc) => {
                    const asyncFunc = async function (ItemDoc: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>) {
                        var returnItem : Item;
                        // get the data
                        const itemData = ItemDoc.data();
                        // get the subcollection LikedItems and look for the number of likes the item has by .where
                        const peopleLiked = await db.collectionGroup("LikedItems").where("ItemID", "==", ItemDoc.id).get();
                        const likes = peopleLiked.size;
                        // if title is not null, the rest of the fields are unlikely to be.
                        if (itemData.Title as string) {
                            // the rest of the logic to convert from database to model is in the constructor
                            returnItem = new Item(ItemDoc.id, itemData.Title, itemSeller, likes, itemData.ListedTime, itemData.Price, itemData.Rating, itemData.Description, itemData.TransactionInformation, itemData.ProcurementInformation, itemData.Category, itemData.Stock, itemData.Image1, itemData.Image2, itemData.Image3, itemData.Image4, itemData.AdvertisementPoints, itemData.isDiscounted, itemData.isRestocked, itemData.isUsed, itemData.Location);
                        }
                        return returnItem;
                    }
                    promises.push(asyncFunc(ItemDoc))
                });
                return await Promise.all(promises);
            }
            const processSeller = async function (sellerDoc: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>): Promise<Array<Item>> {
                const sellerData = sellerDoc.data();
                // check for non null / empty strings
                if (sellerData.Name as string && sellerData.UID as string) {
                    const sellerAuth = await mAuth.getUser(sellerData.UID);
                    // this is all the seller information we need
                    let itemSeller = new Seller(sellerAuth.displayName, sellerData.UID, sellerAuth.photoURL); // placeholder profile picture
                    const refItem = sellerDoc.ref.collection("Items");
                    // push all the promises to a list so we can run all our queries in parallel
                    return (processRefItem(itemSeller, refItem));
                }
                return null;
            }
            // process every seller
            sellerSnapshot.forEach(doc => {
                promisesProcessSeller.push(processSeller(doc));
            });
            const arrayOfItems = await Promise.all(promisesProcessSeller);
            arrayOfItems.forEach((itemArray) => {
                returnArray = returnArray.concat(itemArray);
            });
            returnArray = returnArray.sort((a,b) => b.Performance - a.Performance);
            // cache has been updated.
            updateItemsCache = false;
            ItemsCache = returnArray;
            // avoid creating multiple observers if already observing.
            if(!fromObserver){
                itemsObserveQuery();
            }
        } 
        return ItemsCache;
    } catch (err) {
        // log the error
        console.log(err);
        // handle in try catch of other functions
        throw err;
    }
}/**
 * check for the user type / clearance level, 1 = buyer, 2 = seller, 3 = admin
 * @param userID userID
 */
const checkUserType = async function(userID: string): Promise<number>{
    const usersSnapshot = await db.collection("users").get();
    var returnNum = -1;
    usersSnapshot.forEach((userDoc)=>{
        switch(userDoc.data().Type){
            case "Buyer":
                returnNum = 1;
            case "Seller":
                returnNum = 2;
            case "Admin":
                returnNum = 3;
        }
    });
    // return NEGATIVE so invalid users cannot do anything.
    return returnNum;
}
/**
 * Function to add item, requires item object and userID
 */
export const addItem = functions.region("asia-east2").https.onRequest(async (request, response) => {
    // do not let the user do this if the clearance level is not high enough
    if(await checkUserType(request.body.sellerUID) >= 2){
        // ensure there is only 1 user3
        const userSnapshot = await db.collection("users").where("UID", "==", request.body.userID).limit(1).get();
        userSnapshot.forEach(userDoc => {
            const userData = userDoc.data();
            userDoc.ref.collection("Items").add({
                AdvertisementPoints : 0,
                Category: request.body.Category,
                Description: request.body.Description,
                Likes: 0,
                ListedTime: new Date(),
                NumberSold: 0,
                Price: request.body.Price,
                ProcurementInformation: request.body.ProcurementInformation,
                Rating: 0,
                SellerName: userData.Username,
                SellerUID: userData.UID,
                SellerImageURL: userData.ImageURL,
                Image1: request.body.Image1,
                Image2: request.body.Image2,
                Image3: request.body.Image3,
                Image4: request.body.Image4,
                Stock: request.body.Stock,
                Title: request.body.Title,
                TransactionInformation: request.body.TransactionInformation,
                isActive : true,
                isDiscounted : false,
                isRestocked : false
            });
        });
        response.send("success");
    }else{
        response.send("not success");
    }
});

export const helloWorld = functions.region("asia-east2").https.onRequest((request, response) => {
    response.send("Hello from Firebase!");
});
