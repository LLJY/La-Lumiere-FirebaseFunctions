import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import { v4 as uuidv4 } from "uuid";
import * as stream from "stream";

admin.initializeApp({
  storageBucket: "la-lumire-asia",
});
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
  public NumberSold: number;
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
  //we really should not add logic into a constructor, but im lazy so i don't really care
  constructor(
    ListingID: string,
    Title: string,
    seller: Seller,
    Likes: number,
    NumberSold: number,
    ListedTime: FirebaseFirestore.Timestamp,
    Price: number,
    Rating: number,
    Description: string,
    TransactionInformation: string,
    ProcurementInformation: string,
    Category: string,
    Stock: number,
    Image1: string,
    Image2: string,
    Image3: string,
    Image4: string,
    AdvertisementPoints: number,
    isDiscounted: boolean,
    isRestocked: boolean,
    isUsed: boolean,
    Location: string
  ) {
    this.ListingID = ListingID;
    this.Title = Title;
    this.sellerName = seller.Name;
    this.sellerUID = seller.UID;
    Location;
    this.sellerImageURL = seller.pictureURL;
    this.Likes = Likes;
    this.NumberSold = NumberSold;
    this.ListedTime = ListedTime.toDate().toISOString();
    this.Price = Price;
    this.Rating = Rating;
    this.Description = Description;
    this.TransactionInformation = TransactionInformation;
    this.ProcurementInformation = ProcurementInformation;
    this.Category = Category;
    this.Stock = Stock;
    this.isAdvert = AdvertisementPoints != 0;
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
    this.Performance =
      (Likes / (new Date().valueOf() - ListedTime.toDate().valueOf())) *
      Math.max(AdvertisementPoints, 1);
    this.Location = Location;
    this.isUsed = isUsed;
  }
}

class Seller {
  constructor(
    public Name: string,
    public UID: string,
    public pictureURL: string
  ) {}
}
//#region Simple cache and observables to speed things up (firebase is slow as fuck).
// cache all the items in the database for faster user access.
let ItemsCache: Array<Item>;
let CategoriesCache: Array<string>;
let updateItemsCache = true;
let updateCategoriesCache = true;
// observe for changes in items, then update cache when necessary
let itemsObserveQuery = function () {
  db.collectionGroup("Items").onSnapshot(
    (snapshot) => {
      updateItemsCache = true;
      // do not await as onSnapshot is not promise aware
      getAllItems(true);
    },
    (err) => {
      console.error(err);
    }
  );
};
let categoriesObserveQuery = function () {
  db.collection("Categories").onSnapshot(
    (snapshot) => {
      updateCategoriesCache = true;
      // do not await as onSnapshot is not promise aware
      getAllCategories(true);
    },
    (err) => {
      console.error(err);
    }
  );
};
//#endregion

//#region Items CRUD, (get items by categories and update/add/delete items)

/**
 * Uploads an image to firebase storage using its raw base64 values
 * @param base64 Image base 64
 */
let uploadImage = async (base64: string) => {
    try {
      // create new stream
      let bufferStream = new stream.PassThrough();
      bufferStream.end(Buffer.from(base64.split(",")[1], "base64"));
      // get the file reference in firebase storage and generate a uuid for the filename
      let file = admin.storage().bucket().file(`images/${uuidv4()}.jpg`);
      // create a promise to await for the stream to complete
      let returnFile: any = await new Promise((resolve, reject) => {
        bufferStream
          .pipe(
            file.createWriteStream({
              metadata: {
                contentType: "image/jpeg",
              },
            })
          )
          // return the file
          .on("finish", () => resolve(file))
          .on("error", () => reject);
      });
      return returnFile;
    } catch (ex) {
      console.error(ex.toString());
      // throw an exception to be handled.
      throw ex;
    }
  }; 
/**
 * Delete by item id.
 */
export const deleteItem = functions
  .region("asia-east2")
  .https.onCall(async (data) => {
    try {
      if ((await checkUserType(data.sellerUID)) >= 2) {
        const userSnapshot = await db
          .collection("users")
          .where("UID", "==", data.userID)
          .limit(1)
          .get();
        // doesn't matter, there's only one user
        userSnapshot.forEach((userDoc) => {
          // delete the document where listingid matches.
          userDoc.ref.collection("Items").doc(data.item.listingId).delete();
        });
        return "success";
      }
      // let the frontend deal with this
      return "not success";
    } catch (ex) {
      console.error(ex);
      throw ex;
    }
  });
/**
 * Function to add item, requires item object and userID
 */
export const addItem = functions
  .region("asia-east2")
  .https.onCall(async (data) => {
    try {
      // do not let the user do this if the clearance level is not high enough
      if ((await checkUserType(data.sellerUID)) >= 2) {
        let images = new Array<string>();
        for (let index = 0; index < data.item.images.length; index++) {
          const image = data.item.images[index];
          // upload every image and get the url
          images.push(
            await (await uploadImage(image)).getSignedUrl({
              action: "read",
              expires: "03/09/2500",
            })
          );
        }
        const userSnapshot = await db
          .collection("users")
          .where("UID", "==", data.userID)
          .limit(1)
          .get();
        userSnapshot.forEach((userDoc) => {
          const userData = userDoc.data();
          userDoc.ref.collection("Items").add({
            AdvertisementPoints: 0,
            Category: data.item.category,
            Description: data.item.description,
            Likes: 0,
            ListedTime: new Date(),
            NumberSold: 0,
            Price: data.item.price,
            ProcurementInformation: data.item.procurementInformation,
            Rating: 0,
            SellerName: userData.Username,
            SellerUID: userData.UID,
            SellerImageURL: userData.ImageURL,
            // if the index exists, upload it, else, put an empty string, the frontend filters it out anyway.
            Image1: images[0] ? images[0] : "",
            Image2: images[1] ? images[1] : "",
            Image3: images[2] ? images[2] : "",
            Image4: images[3] ? images[3] : "",
            Stock: data.item.stock,
            Title: data.item.title,
            TransactionInformation: data.item.transactionInformation,
            isActive: true,
            isDiscounted: false,
            isRestocked: false,
            isUsed: false,
            Location: data.item.location,
          });
        });
        return "success;";
      } else {
        return "not success";
      }
    } catch (ex) {
      console.error(ex.toString());
      throw ex;
    }
  });
//TODO ALLOW IMAGE UPDATE
/**
 * Update Item via the edit function.
 */
export const updateItem = functions
  .region("asia-east2")
  .https.onCall(async (data) => {
    try {
    // get the user which the item belongs to
      const userSnapshot = await db
        .collection("users")
        .where("UID", "==", data.userID)
        .limit(1)
        .get();
      let userDoc: any;
      userSnapshot.forEach((doc) => {
        userDoc = doc;
      });
      // update the item document
      await userDoc.ref.collection("Items").doc(data.item.listingId).update({
          // advertisement points will be implemented in the future
        AdvertisementPoints: 0,
        Category: data.item.category,
        Description: data.item.description,
        Price: data.item.price,
        ProcurementInformation: data.item.procurementInformation,
        Stock: data.item.stock,
        Title: data.item.title,
        TransactionInformation: data.item.transactionInformation,
      });
      return "success";
    } catch (err) {
      console.error(err);
      throw err;
    }
  });
  export const getLikedItemsfunctions = functions
  .region("asia-east2")
  .https.onCall(async (data) => {
    try{
    // get all items so we can filter it later
    let arrayItem = await getAllItems();
    // sort by performance level
    arrayItem = await markLikedItems(data.userID, arrayItem);
    arrayItem.filter(x=>x.userLiked);
    arrayItem = arrayItem.sort((x) => x.Performance);
    return arrayItem;
    }catch(ex){
        console.error(ex.toString());
        throw ex;
    }
  });
/**
 * Get Items from people the user follows
 */
export const getItemByFollowed = functions
.region("asia-east2")
.https.onCall(async (data) => {
  try {
    // get all items so we can filter it later
    let arrayItem = await getAllItems();
    // sort by performance level
    arrayItem = arrayItem.sort((x) => x.Performance);
    if (data.userID) {
      arrayItem = await markLikedItems(data.userID, arrayItem);
    }
    // send the response after all the final modifications
    const promises1 = new Array<
      Promise<FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>>
    >();
    const user = await db
      .collection("users")
      .where("UID", "==", data.userID)
      .get();
    user.forEach((user) => {
      promises1.push(user.ref.collection("Following").get());
    });
    const followerSnapshots = await Promise.all(promises1);
    let returnList = new Array<Item>();
    followerSnapshots.forEach((followerSnapshot) => {
      followerSnapshot.forEach((followerDoc) => {
        const followerData = followerDoc.data();
        //avoid just filtering everything and filter it to a sublist that we will concat to the mainlist
        returnList.push.apply(
          returnList,
          arrayItem.filter((x) => x.sellerUID == followerData.UserID)
        );
      });
    });
    // if limit is given, only take x amount to limit
    if (data.limit) {
      returnList = returnList.slice(0, data.limit);
    }
    return returnList;
  } catch (err) {
    // log the error
    console.error(err);
    throw err;
  }
});

/**
* Get suggested items by the user's ID, right now we are only filtering it by subscribed categories
*/
export const getItemBySuggestion = functions
.region("asia-east2")
.https.onCall(async (data) => {
  try {
    // get all items and filter it afterwards
    let allItems = await getAllItems();
    const userSnapshot = await db
      .collection("users")
      .where("UID", "==", data.userID)
      .limit(1)
      .get();
    let userDoc: FirebaseFirestore.QueryDocumentSnapshot;
    // run a foreach, there is only 1 but this is the only way to get the item...
    userSnapshot.forEach((doc) => {
      userDoc = doc;
    });
    // get the user's subscrobed category
    const subscribedCategoriesSnapshot = await userDoc.ref
      .collection("SubscribedCategories")
      .get();
    // if there are no results, this will not run, so just return everything for now. we can make this more sophisticated in the future.
    subscribedCategoriesSnapshot.forEach((subDoc) => {
      const categoryData = subDoc.data();
      allItems = allItems.filter(
        (x) => x.Category == categoryData.CategoryName
      );
    });
    //mark liked items
    if (data.userID) {
      allItems = await markLikedItems(data.userID, allItems);
    }
    // if limit is given, only take x amount to limit
    if (data.limit) {
      allItems = allItems.slice(0, data.limit);
    }
    return allItems;
  } catch (err) {
    console.error(err);
    throw err;
  }
});
/**
* Get seller items by seller's UID
*/
export const getSellerItems = functions
.region("asia-east2")
.https.onCall(async (data) => {
try {
  let allItems = await getAllItems();
  // let try catch handle the error if userID is null
  allItems = allItems.filter((x) => x.sellerUID == data.userID);
  //mark liked items
  if (data.userID) {
    allItems = await markLikedItems(data.userID, allItems);
  }

  // send all the items
  return allItems;
} catch (err) {
  console.error(err);
  throw err;
}
});
/**
* Filters the items by the hottest/best performance level
*/
export const getHottestItems = functions
.region("asia-east2")
.https.onCall(async (data) => {
try {
  let arrayItem = await getAllItems();
  //if the userID exists in the request body, add their liked items
  if (data.userID) {
    arrayItem = await markLikedItems(data.userID, arrayItem);
  }
  // send the response after all the final modifications
  // if limit is given, only take x amount to limit
  if (data.limit) {
    arrayItem = arrayItem.slice(0, data.limit);
  }
  return arrayItem;
} catch (err) {
  // log the error
  console.error(err);
  throw err;
}
});
/**
* adds the user to the item's liked users. Requires user id and itemID
*/
export const likeItem = functions
.region("asia-east2")
.https.onCall(async (data) => {
  try {
    const userSnapshot = await db
      .collection("users")
      .where("UID", "==", data.userID)
      .limit(1)
      .get();
    userSnapshot.forEach((userDoc) => {
      //there is only one user so it is fine
      userDoc.ref.collection("LikedItems").add({
        ItemID: data.itemID,
      });
    });
    return "success";
  } catch (err) {
    console.error(err);
    throw err;
  }
});
/**
* removes the liked item from the user, requires itemID and userID
*/
export const unLikeItem = functions
.region("asia-east2")
.https.onCall(async (data) => {
  try {
    const userSnapshot = await db
      .collection("users")
      .where("UID", "==", data.userID)
      .limit(1)
      .get();
    const promises = new Array<Promise<any>>();
    userSnapshot.forEach((userDoc) => {
      //there is only one user so it is fine
      const asyncFunc = async function (
        userDoc: FirebaseFirestore.QueryDocumentSnapshot<
          FirebaseFirestore.DocumentData
        >
      ) {
        const liked = await userDoc.ref
          .collection("LikedItems")
          .where("ItemID", "==", data.itemID)
          .get();
        liked.forEach((element) => {
          element.ref.delete();
        });
        // we don't actually need to return anything, but we will just return something so we can await it using Promise.all
      };
      promises.push(asyncFunc(userDoc));
    });
    // wait for everything to complete before returning
    await Promise.all(promises);
    return "success";
  } catch (err) {
    console.error(err);
    throw err;
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
  const userDocs = await db
    .collection("users")
    .where("UID", "==", userID)
    .limit(1)
    .get();
  let userDoc: FirebaseFirestore.QueryDocumentSnapshot;
  // run a foreach, there is only 1 but this is the only way to get the item...
  userDocs.forEach((doc) => {
    userDoc = doc;
  });
  const likedItems = await userDoc.ref.collection("LikedItems").get();
  likedItems.forEach((likedDoc) => {
    const likedItemData = likedDoc.data();
    if (likedItemData.ItemID) {
      // lambda that marks every item with the same listing id as a liked item as liked.
      // the ternary is to avoid marking items already true as false again.
      Items = Items.map((x) => {
        x.userLiked = x.userLiked
          ? true
          : x.ListingID == likedItemData.ItemID;
        return x;
      });
    }
  });
} catch (err) {
  console.error(err);
}
return Items;
};

/**
* gets all the items from firebase/firestore
*/
const getAllItems = async function (
fromObserver: Boolean = false
): Promise<Array<Item>> {
try {
  //if the cache is due for an update, get it.
  if (updateItemsCache) {
    let returnArray = new Array<Item>();
    //only get sellers
    const sellerSnapshot = await db
      .collection("users")
      .where("Type", "==", "Seller")
      .get();
    // this is the list of promises/awaitables for all items
    // we will run the seller function in parallel to speed things up
    const promisesProcessSeller = new Array<Promise<Array<Item>>>();
    const processRefItem = async function (
      itemSeller: Seller,
      refItem: FirebaseFirestore.CollectionReference<
        FirebaseFirestore.DocumentData
      >
    ): Promise<Array<Item>> {
      let arrayItem = new Array<Item>();
      const itemSnapshot = await refItem.get();
      const promises = new Array<Promise<Item>>();
      itemSnapshot.forEach((ItemDoc) => {
        const asyncFunc = async function (
          ItemDoc: FirebaseFirestore.QueryDocumentSnapshot<
            FirebaseFirestore.DocumentData
          >
        ) {
          let returnItem: Item;
          // get the data
          const itemData = ItemDoc.data();
          // get the subcollection LikedItems and look for the number of likes the item has by .where
          const peopleLiked = await db
            .collectionGroup("LikedItems")
            .where("ItemID", "==", ItemDoc.id)
            .get();
          const likes = peopleLiked.size;
          // if title is not null, the rest of the fields are unlikely to be.
          if (itemData.Title as string) {
            // the rest of the logic to convert from database to model is in the constructor
            returnItem = new Item(
              ItemDoc.id,
              itemData.Title,
              itemSeller,
              likes,
              itemData.NumberSold,
              itemData.ListedTime,
              itemData.Price,
              itemData.Rating,
              itemData.Description,
              itemData.TransactionInformation,
              itemData.ProcurementInformation,
              itemData.Category,
              itemData.Stock,
              itemData.Image1,
              itemData.Image2,
              itemData.Image3,
              itemData.Image4,
              itemData.AdvertisementPoints,
              itemData.isDiscounted,
              itemData.isRestocked,
              itemData.isUsed,
              itemData.Location
            );
          }
          return returnItem;
        };
        promises.push(asyncFunc(ItemDoc));
      });
      return await Promise.all(promises);
    };
    const processSeller = async function (
      sellerDoc: FirebaseFirestore.QueryDocumentSnapshot<
        FirebaseFirestore.DocumentData
      >
    ): Promise<Array<Item>> {
      const sellerData = sellerDoc.data();
      // check for non null / empty strings
      if ((sellerData.Name as string) && (sellerData.UID as string)) {
        // this is all the seller information we need
        let itemSeller = new Seller(
          sellerData.Username,
          sellerData.UID,
          sellerData.ImageURL
        ); // placeholder profile picture
        const refItem = sellerDoc.ref.collection("Items");
        // push all the promises to a list so we can run all our queries in parallel
        return processRefItem(itemSeller, refItem);
      }
      return null;
    };
    // process every seller
    sellerSnapshot.forEach((doc) => {
      promisesProcessSeller.push(processSeller(doc));
    });
    const arrayOfItems = await Promise.all(promisesProcessSeller);
    arrayOfItems.forEach((itemArray) => {
      returnArray = returnArray.concat(itemArray);
    });
    returnArray = returnArray.sort((a, b) => b.Performance - a.Performance);
    // cache has been updated.
    updateItemsCache = false;
    ItemsCache = returnArray;
    // avoid creating multiple observers if already observing.
    if (!fromObserver) {
      itemsObserveQuery();
    }
  }
  return ItemsCache;
} catch (err) {
  // log the error
  console.error(err);
  // handle in try catch of other functions
  throw err;
}
};
  //#endregion

//#region Get classification (categories, procurement type, payment type)
/**
 * Simple function that gets all the item categories
 */
export const getCategories = functions
  .region("asia-east2")
  .https.onCall(async (data) => {
    try {
      // just send the getAllCategories function, which handles caching too.
      return await getAllCategories();
    } catch (err) {
      console.error(err);
      throw err;
    }
  });
const getAllCategories = async function (
  fromObserver: Boolean = false
): Promise<Array<string>> {
  try {
    if (updateCategoriesCache) {
      const categoriesSnapshot = await db.collection("Categories").get();
      let categories = new Array<string>();
      // push the categories
      categoriesSnapshot.forEach((category) => {
        categories.push(category.data().Name);
      });
      categories = categories.sort();
      // assign to the cache and return the cache when called
      CategoriesCache = categories;
      // do not update the next time as it has already been updated.
      updateCategoriesCache = false;
      // avoid calling another observer if already from one
      if (!fromObserver) {
        // run the observe function so we update categories if there is an update.
        categoriesObserveQuery();
      }
    }
    return CategoriesCache;
  } catch (err) {
    console.error(err);
    return null;
  }
};
/**
 * Simple function that gets all the procurement types
 */
export const getProcurementTypes = functions
  .region("asia-east2")
  .https.onCall(async (data) => {
    try {
      let procurementTypes = new Array<string>();
      const procurmentSnapshot = await db.collection("ProcurementTypes").get();
      procurmentSnapshot.forEach((procurementDoc) => {
        // add the name of the procurement type for every
        procurementTypes.push(procurementDoc.data().Name);
      });
      // sort by alphebetical order
      procurementTypes = procurementTypes.sort();
      return procurementTypes;
    } catch (err) {
      console.error(err);
      throw err;
    }
  });
/**
 * Simple function that gets all the payment types
 */
export const getPaymentTypes = functions
  .region("asia-east2")
  .https.onCall(async (data) => {
    try {
      let paymentTypes = new Array<string>();
      const procurmentSnapshot = await db.collection("PaymentTypes").get();
      procurmentSnapshot.forEach((paymentDoc) => {
        // add the name of the payment type for every
        paymentTypes.push(paymentDoc.data().Name);
      });
      // sort by alphebetical order
      paymentTypes = paymentTypes.sort();
      return paymentTypes;
    } catch (err) {
      console.error(err);
      throw err;
    }
  });
  //#endregion

//#region User operations, signup, getUserinfo, etc...
/**
 * check for the user type / clearance level, 1 = buyer, 2 = seller, 3 = admin
 * @param userID userID
 */
const checkUserType = async function (userID: string): Promise<number> {
    const usersSnapshot = await db.collection("users").get();
    let returnNum = -1;
    usersSnapshot.forEach((userDoc) => {
      switch (userDoc.data().Type) {
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
  };
  export const signUp = functions
  .region("asia-east2")
  .https.onCall(async (data) => {
    try {
        // user id is provided when logging in with a provider.
        if(data.userID){
            //get the user
            let user = await admin.auth().getUser(data.userID);
            // if there is no user in the database, update it
            let collectionResults = await db.collection("users").where("UID", "==", data.userID).get();
            let collectionResult;
            if(collectionResults.size > 0){
                //user exists! do nothing.
                return {id: user.uid}
            }
            // user does not exist, create him
            await db.collection("users").add({
                // if photourl does not exist, use the default one.
                ImageURL: user.photoURL? user.photoURL:"https://www.clipartmax.com/png/full/171-1717870_prediction-clip-art.png" ,
                Name: user.displayName,
                // user can update this later.
                Username: user.displayName,
                // always buyer by default
                Type: "Buyer",
                UID: user.uid,
            });
            return {id: user.uid}

        }else{
            // add the user if userID is not provided
            const user = await admin.auth().createUser({
                email: data.email,
                displayName: data.username,
                photoURL:
                  "https://www.clipartmax.com/png/full/171-1717870_prediction-clip-art.png",
                password: data.password,
                disabled: false,
                emailVerified: false,
              });
              db.collection("users").add({
                ImageURL: data.ImageURL,
                Name: data.fullName,
                Type: "Buyer",
                UID: data.uid,
                Username: user.uid,
              });
              // return the user's uid as a json
              return {
                id: user.uid,
              };
        }
      
    } catch (err) {
      throw err;
    }
  });
  
  /**
 * returns the user's information using userID, not the most secure thing on the planet but hey
 * TLS encryption on https and api key should save our asses lol.
 */
export const getUserInfo = functions
.region("asia-east2")
.https.onCall(async (data) => {
  return (await getUser(data.userID));
});
let getUser = async(userId: string)=>{
        try {
          const users = await db
            .collection("users")
            .where("UID", "==", userId)
            .get();
          let returnUser = new Object();
          users.forEach((user) => {
            let userType = 0;
            switch (user.data().Type) {
              case "Admin":
                userType = 2;
                break;
              case "Buyer":
                userType = 0;
                break;
              case "Seller":
                userType = 1;
                break;
            }
            // foreach and assign every last user with the same uid(impossible) to returnUser
            returnUser = {
              uid: user.data().UID,
              name: user.data().Name,
              ImageURL: user.data().ImageURL,
              userType: userType,
              about: user.data().About,
              username: user.data().Username,
            };
          });
          // return returnUser;
          return returnUser;
        } catch (ex) {
          console.error(ex);
          throw ex;
        }
}
/**
 * Updates users
 */
export const updateUser = functions
  .region("asia-east2")
  .https.onCall(async (data) => {
    try {
        // if base64 exists
        if(data.base64){
            // upload the base64 image and replace imageurl with the new signed url.
            data.user.ImageURL = await (await uploadImage(data.base64)).getSignedUrl({
                action: "read",
                expires: "03/09/2500",
              });
        }
        // get the user which the item belongs to
        const userSnapshot = await db
            .collection("users")
            .where("UID", "==", data.userID)
            .limit(1)
            .get();
            // there is only one user, no harm doing a foreach
        userSnapshot.forEach((doc) => {
            db.collection("users").doc(doc.id).update({
                ImageURL: data.user.ImageURL,
                Name: data.user.name,
                Username: data.user.username,
                About: data.user.about
            });
        });
        // send a notification for my distinction.
        var message = {
          name: "my_notification",
          notification: {
            body: "Profile Updated!",
            title: `Your profile has been successfully updated at ${new Date().toLocaleDateString()}`,
          },
          data: {
            notification_foreground: "true",
          },
          token: data.token,
        };
          
        admin.messaging().send(message)
        return "success";
    } catch (err) {
      console.error(err);
      throw err;
    }
  });

//#endregion

export const helloWorld = functions
  .region("asia-east2")
  .https.onCall((data) => {
    return "Hello from La Lumiere!";
  });
