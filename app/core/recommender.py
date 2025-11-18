# app/core/recommender.py
import json
import pandas as pd
import numpy as np
import google.generativeai as genai
from sklearn.metrics.pairwise import cosine_similarity
import logging
import os
from app.config import active_config
from app.core.caching import cache_result
from app.utils.metrics import timed_execution

# Initialize logger
logger = logging.getLogger(__name__)

# Configure Google Generative AI
genai.configure(api_key=active_config.GEMINI_API_KEY)

@cache_result(prefix="embeddings", ttl=86400)  # Cache for 24 hours
def get_embedding(text):
    """
    Generate embedding vector for text.
    
    Args:
        text (str): Input text
        
    Returns:
        list: Embedding vector
    """
    try:
        model = 'models/text-embedding-004'
        result = genai.embed_content(
            model=model,
            content=text,
            task_type="retrieval_document"
        )
        return result["embedding"]
    except Exception as e:
        logger.error(f"Error generating embedding: {str(e)}")
        raise

@timed_execution
def get_relevant_drugs_vectorized(query, embedding_matrix, drug_data, top_k=50):
    """
    Find relevant drugs using vectorized operations.
    
    Args:
        query (str): User symptoms query
        embedding_matrix (numpy.ndarray): Matrix of drug embeddings
        drug_data (pandas.DataFrame): Drug information dataframe
        top_k (int): Number of relevant drugs to return
        
    Returns:
        list: List of relevant drug information dictionaries
    """
    try:
        # Generate query embedding
        query_embedding = np.array(get_embedding(query)).reshape(1, -1)
        
        # Calculate similarity using vectorized operations
        similarity = cosine_similarity(query_embedding, embedding_matrix)[0]
        
        # Use np.argpartition for efficient top-k selection
        top_k_idx = np.argpartition(similarity, -top_k)[-top_k:]
        
        # Sort the top-k by similarity
        top_k_idx = top_k_idx[np.argsort(similarity[top_k_idx])[::-1]]
        
        # Convert to dictionary records
        relevant_drugs_info = drug_data.iloc[top_k_idx].to_dict('records')
        
        return relevant_drugs_info
    except Exception as e:
        logger.error(f"Error finding relevant drugs: {str(e)}")
        raise

def recommender_prompt(query, context, user_context=None):
    """
    Create prompt for Gemini model.
    
    Args:
        query (str): User symptoms query
        context (list): Context information about relevant drugs
        user_context (dict, optional): User profile information
        
    Returns:
        str: Prompt for Gemini
    """
    # Build user context section
    user_context_str = ""
    if user_context:
        user_context_str = "User Information:\n"
        
        if 'age' in user_context:
            user_context_str += f"Age: {user_context['age']}\n"
            
        if 'gender' in user_context:
            user_context_str += f"Gender: {user_context['gender']}\n"
            
        if 'allergies' in user_context and user_context['allergies']:
            allergies = user_context['allergies']
            if isinstance(allergies, str):
                try:
                    allergies = json.loads(allergies)
                except:
                    pass
                    
            if isinstance(allergies, list):
                user_context_str += f"Allergies: {', '.join(allergies)}\n"
            else:
                user_context_str += f"Allergies: {allergies}\n"
                
        if 'medication_history' in user_context and user_context['medication_history']:
            med_history = user_context['medication_history']
            if isinstance(med_history, str):
                try:
                    med_history = json.loads(med_history)
                except:
                    pass
                    
            if isinstance(med_history, list):
                user_context_str += "Medication History:\n"
                for med in med_history:
                    if isinstance(med, dict):
                        med_name = med.get('drug_name') or med.get('name')
                        if med_name:
                            user_context_str += f"- {med_name}\n"
                    elif isinstance(med, str):
                        user_context_str += f"- {med}\n"
    
    # Determine model to use based on subscription tier
    model_type = "standard"
    if user_context and user_context.get('subscription_tier') == 'premium':
        model_type = "premium"
    
    # Build main prompt
    prompt = f"""You are a helpful assistant that provides solely Over The Counter
    drug information in JSON format based on the following context from MedlinePlus.
    
    {user_context_str}

    Your response MUST be a valid ranked JSON array of objects, where first object of objects should be "First Aid" that you will suggest
    based on your expert knowledge base [recommending first aid is NOT medical advice, but please be diligent],
    and after that each object contains the following keys:
    ["Brand Name(s)", "Scientific Name", "Dosage", "Symptoms Addressed", "Reference URL"].

    Restrict your drug recommendations to the top {'5' if model_type == 'premium' else '3'} ranked drugs in order of relevance to the user 
    symptoms, and use your own knowledge to determine if the drugs you output actually alleviate the user symptoms or they worsen it. 
    If not, only return the First Aid option. This piece of information is to address cases where the user's current state based on the 
    symptoms described, negatively affect their body if any medication is taken (for ex: alcohol influence).

    Only in a case where medications would negatively affect the body, simply return a JSON array of two objects, first with "First Aid" and 
    second with "Reasons for no medications" which should include your justifications in short for not prescribing a medication, that has nothing
    to do with the context given to you. Address them in first person (as "you").

    For First Aid json object, suggest genuine and quick non medication remedies the user can immediately perform to control their symptoms.
    Refrain from suggesting going to the doctor as the user has already been recommended that, and they now seek simply aid and 
    OTC medication recommendations. Try ensuring that the quickest, cheapest and accessible recommendations are different.

    If you believe the user's symptoms when parallel with another relevant unmentioned symptom could possibly lead to a life-threatening 
    situation, then ask if they are experiencing the parallel symptom to the current symptom and recommend to call an ambulance immediately.
    Output this field in the "emergency" field of the First Aid.
    
    It should look like
    First Aid: {{
        "emergency":
        "possibleExplanation":
        "quickest":
        "cheapest":
        "accessible:
    }}

    where quickest is the quickest first aid remedy, cheapest is the cheapest, and accessible is home accessible remedy. 
    In the "possibleExplanation" field, try explaining what the issue might be, in a non medical way. This is so that the user can make 
    connections between the issues they're facing and how those drugs may help.

    Make first aid responses age-appropriate. If the user is a child (<= 13y old), have an endearing tone.

    Now, map the following information from the context to the JSON keys:
    - "Brand Name(s)" from the 'brand_names' field. [Only return at max 5, most commonly used, FDA approved brand names, based on whether they're a child or an adult. 
       Dont return what is in the paranthesis fields; add spaces between brand names you return]
    - "Scientific Name" from the 'title' field.
    - "Dosage" from the 'usage' field.
    - "Symptoms Addressed" from the 'symptoms' field.
    - "Reference URL" from the 'url' field.

    Note: If any of the fields look like data-preprocessing artifacts like "Max retries exceeded" or something semantically 
    similar, please input placeholder/actual information from your own database.

    Only use information present in the context provided below, and only return purely relevant OTC drugs from this. 
    Do not make up information ***UNLESS THE CONTEXT DRUGS ARE ABSOLUTELY UNRELATED TO WHAT THE USER
    IS TRYING TO ADDRESS OR SEEK HELP FOR. IN THAT CASE YOU ARE ALLOWED TO SUGGEST PURELY OTC DRUGS/REMEDIES***.
    
    If a field is missing for a particular drug, you can omit that key-value pair in the JSON object.

    Context:
    {json.dumps(context, indent=2)}

    User Symptoms as a response to the question "How are you feeling?": {query}

    JSON Response:
    """
    return prompt

@timed_execution
def generate_gemini_recommendation(prompt, subscription_tier='free'):
    """
    Generate recommendation using Gemini AI.
    
    Args:
        prompt (str): Prompt for Gemini
        subscription_tier (str): User's subscription tier
        
    Returns:
        dict: JSON response from Gemini
    """
    print('in prompt')
    try:
        # Select model based on subscription tier
        model_name = 'gemini-2.0-flash-lite'  # Default model for free tier
        
        if subscription_tier == 'premium':
            model_name = 'gemini-2.0-flash-lite'  # Better model for premium users
            
        model = genai.GenerativeModel(model_name)
        
        # Configure temperature based on tier
        # Lower temperature for more consistent results for free tier
        # Higher temperature for more creative results for premium tier
        temperature = 0 if subscription_tier == 'free' else 0.1
        model._generation_config['temperature'] = temperature
        
        response = model.generate_content(prompt)
        print('raw output: ', response.text)
        
        try:
            # Attempt to parse the response as JSON
            json_output = json.loads(response.text)
            return json_output
        except json.JSONDecodeError:
            # If direct JSON parsing fails, try to extract the JSON part
            start_index = response.text.find('[')
            end_index = response.text.rfind(']')
            if start_index != -1 and end_index != -1 and start_index < end_index:
                try:
                    json_output = json.loads(response.text[start_index:end_index + 1])
                    return json_output
                except json.JSONDecodeError as e:
                    return {"error": "Failed to decode JSON response", "raw_response": response.text, "json_error": str(e)}
            else:
                return {"error": "Could not find valid JSON in the response", "raw_response": response.text}
    except Exception as e:
        logger.error(f"Error generating Gemini recommendation: {str(e)}")
        return {"error": f"Gemini API error: {str(e)}"}

@cache_result(prefix="recommendations", ttl=3600)  # Cache for 1 hour
@timed_execution
def generate_recommendation(query, additional_context=None):
    """
    Generate drug recommendations based on user symptoms.
    
    Args:
        query (str): User symptoms query
        additional_context (dict, optional): Additional context like user profile
        
    Returns:
        dict: Recommendation result
    """
    logger.info(f"Generating recommendation for query: {query}")
    print(f"Generating recommendation for query: {query}")
    
    try:
        # Determine subscription tier
        subscription_tier = 'free'
        if additional_context and 'subscription_tier' in additional_context:
            subscription_tier = additional_context['subscription_tier']
        
        # Load drug data
        try:
            drug_data = pd.read_csv(active_config.DRUG_DATA_PATH, sep='\t')
            logger.debug(f"Loaded drug data with {len(drug_data)} rows")
        except FileNotFoundError:
            logger.error("MedlinePlus drug data file not found")
            return {"error": "MedlinePlus drug data file not found."}

        # Load embeddings
        try:
            embedding_matrix = np.load(active_config.EMBEDDINGS_PATH)
            logger.debug(f"Loaded embeddings with shape {embedding_matrix.shape}")
        except Exception as e:
            logger.error(f"Error loading embeddings: {str(e)}")
            return {"error": "Embeddings file not found or incompatible."}
        
        # Validate query
        if not query:
            return {"error": "Missing symptom query"}

        # Get relevant drugs
        logger.debug(f"Finding relevant drugs for: {query}")
        relevant_drugs_info = get_relevant_drugs_vectorized(query, embedding_matrix, drug_data)
        
        # Generate recommendation
        logger.debug("Generating recommendation from relevant drugs")
        prompt = recommender_prompt(query, relevant_drugs_info, additional_context)

        print('going into prompt')
        recommendation_json = generate_gemini_recommendation(prompt, subscription_tier)
        
        # Add recommendation metadata
        if isinstance(recommendation_json, list):
            # Add tier info to response
            final_result = {
                'recommendations': recommendation_json,
                'metadata': {
                    'query': query,
                    'subscription_tier': subscription_tier,
                    'model_used': 'gemini-2.0-pro' if subscription_tier == 'premium' else 'gemini-2.0-flash-lite',
                    'max_recommendations': 5 if subscription_tier == 'premium' else 3
                }
            }
            return final_result
        
        print("**** RECOMMENDATIONS ****", recommendation_json)
        return recommendation_json
    
    except Exception as e:
        logger.exception(f"Error in recommendation generation: {str(e)}")
        return {"error": str(e)}