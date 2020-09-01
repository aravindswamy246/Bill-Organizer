package com.trail1.billorganiser;

public class UploadedImages {
    private String imageUrl;

    public UploadedImages(){
        //  Empty constructor needed
    }

    public UploadedImages(String imageUrl){
        this.imageUrl = imageUrl;
    }

    public String getImageUrl(){
        return imageUrl;
    }

    public void setImageUrl(String imageUrl){
        this.imageUrl = imageUrl;
    }
}
